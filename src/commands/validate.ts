import { dirname } from 'node:path';
import chokidar from 'chokidar';
import { getConfigSourceFiles } from '../config';
import type { SemanticJudgeProvider } from '../judge/types';
import { resolveSpacePluginSchemas } from '../plugins/util';
import { parseRuleFilter } from '../schema/rule-filter';
import { bundledSchemasDir } from '../schema/schema';
import type { FileValidationIssue, RuleSeverity, SpaceContext } from '../types';
import { formatErrors, ruleViolationMessage, validateSpace } from '../validate';

export async function validate(
  context: SpaceContext,
  options: {
    json?: boolean;
    depth?: number;
    includeGated?: boolean;
    semantic?: boolean;
    judge?: string;
    ruleFilter?: string[];
    judgeProvider?: SemanticJudgeProvider;
  } = {},
): Promise<number> {
  const { schema, schemaRefRegistry } = context;
  const result = await validateSpace(context, {
    depth: options.depth,
    includeGated: options.includeGated,
    semantic: options.semantic,
    judge: options.judge,
    ruleFilter: options.ruleFilter && parseRuleFilter(options.ruleFilter),
    judgeProvider: options.judgeProvider,
  });
  const ruleCounts: Record<RuleSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const v of result.ruleViolations) ruleCounts[v.severity]++;

  // JSON output mode
  if (options.json) {
    const errorsByFile: Record<string, Record<string, FileValidationIssue>> = {};

    const addError = (file: string, key: string, kind: string, message: string, severity?: RuleSeverity) => {
      if (!errorsByFile[file]) errorsByFile[file] = {};
      errorsByFile[file]![key] = severity ? { kind, message, severity } : { kind, message };
    };

    for (const { file, errors: ajvErrors, nodeData } of result.nodeErrors) {
      const formatted = formatErrors(ajvErrors, schema, schemaRefRegistry, nodeData);
      for (const { message, dedupeKey } of formatted) {
        addError(file, `schema:${dedupeKey}`, 'schema', message);
      }
    }
    for (const { file, parent, error } of result.refErrors) {
      addError(file, `broken-link:${parent}`, 'broken-link', `${parent} → ${error}`);
    }
    for (const { title, files } of result.duplicateErrors) {
      for (const file of files) {
        const others = files.filter((f) => f !== file);
        addError(
          file,
          `duplicate:${title}`,
          'duplicate',
          `Duplicate title "${title}" also exists in: ${others.join(', ')}`,
        );
      }
    }
    for (const v of result.ruleViolations) {
      if (v.file && v.severity === 'error') {
        addError(v.file, `rule:${v.ruleId}`, 'rule', ruleViolationMessage(v), v.severity);
      }
    }
    const globalRuleErrorCount = result.ruleViolations.filter((v) => !v.file && v.severity === 'error').length;
    for (const v of result.hierarchyViolations) {
      addError(v.file, `hierarchy:${v.description}`, 'hierarchy', v.description);
    }

    const parseErrorCount = result.parseIssues.filter((i) => i.severity === 'error').length;
    const errorCount =
      Object.values(errorsByFile).reduce((sum, errs) => sum + Object.keys(errs).length, 0) +
      parseErrorCount +
      globalRuleErrorCount;
    console.log(
      JSON.stringify(
        {
          space: context.space.name,
          valid: errorCount === 0,
          validCount: result.validCount,
          errorCount,
          errors: errorsByFile,
          ruleViolations: result.ruleViolations,
          orphanCount: result.orphans.length,
          parseIssues: result.parseIssues,
          unresolvedContentLinks: result.unresolvedContentLinks,
          coverageGates: result.coverageGates,
          skippedByDepth: result.skippedByDepth,
          depthLimit: result.depthLimit,
          semanticEvaluations: result.semanticEvaluations,
        },
        null,
        2,
      ),
    );
    return errorCount > 0 ? 1 : 0;
  }

  // Human-readable output
  const reset = '\x1b[0m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';

  const colorFor = (count: number, isWarning: boolean): string => {
    if (count === 0) return green;
    return isWarning ? yellow : red;
  };

  const fmt = (label: string, count: number, isError = false, isWarning = false): string => {
    let color: string;
    if (isError) {
      color = colorFor(count, isWarning);
    } else {
      color = count > 0 ? green : red;
    }
    const countStr = String(count).padStart(3);
    return `${label.padEnd(40)} ${color}${countStr}${reset}`;
  };

  console.log(`\nSpace Validation Results`);
  console.log(`━`.repeat(45));
  console.log('Content and structure');
  console.log(fmt('  Valid', result.validCount));
  console.log(fmt('  Schema validation errors', result.nodeErrorCount, true));
  console.log(fmt('  Broken links', result.refErrors.length, true));
  console.log(fmt('  Duplicate keys', result.duplicateErrors.length, true));
  console.log(fmt('  Rule violations (error)', ruleCounts.error, true));
  console.log(fmt('  Rule violations (warning)', ruleCounts.warning, true, true));
  console.log(fmt('  Rule violations (info)', ruleCounts.info, true, true));
  console.log(fmt('  Hierarchy violations', result.hierarchyViolations.length, true));
  console.log(fmt('  Orphans (hierarchy nodes - no parent)', result.orphans.length, true, true));
  console.log(fmt('  Unresolved content links', result.unresolvedContentLinks.length, true, true));
  const parseIssueErrorCount = result.parseIssues.filter((i) => i.severity === 'error').length;
  console.log(fmt('  Excluded during parsing', result.parseIssues.length, true, parseIssueErrorCount === 0));
  if (result.depthLimit !== undefined) {
    console.log(fmt('  Skipped by depth limit', result.skippedByDepth.length, true, true));
  }
  const gatedFileCount = result.coverageGates.reduce((sum, g) => sum + g.gatedFiles.length, 0);
  console.log(fmt('  Rule checks gated (cascade)', gatedFileCount, true, true));

  if (result.orphans.length > 0) {
    console.log(`\nOrphans (hierarchy nodes - no parent):`);
    for (const node of result.orphans) console.log(`   ${node.label}`);
  }

  if (result.unresolvedContentLinks.length > 0) {
    console.log(`\nUnresolved content links (may be outside-space or broken):`);
    const byFile = new Map<string, string[]>();
    for (const { file, target } of result.unresolvedContentLinks) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(target);
    }
    for (const [file, targets] of byFile) {
      console.log(`   ${file}:`);
      for (const target of targets) console.log(`      ${target}`);
    }
  }

  if (result.parseIssues.length > 0) {
    console.log(`\nExcluded during parsing:`);
    for (const issue of result.parseIssues) {
      const loc =
        issue.line !== undefined ? `:${issue.line}${issue.column !== undefined ? `:${issue.column}` : ''}` : '';
      const detail = issue.message ? ` - ${issue.message}` : '';
      console.log(`   ${issue.file}${loc}: ${issue.severity} - ${issue.type}${detail}`);
    }
  }

  if (result.nodeErrors.length > 0) {
    console.log(`\nSchema validation errors:`);
    result.nodeErrors.forEach(({ file, line, errors, nodeData }) => {
      const loc = line !== undefined ? `:${line}` : '';
      console.log(`\n   ${file}${loc}:`);
      const formatted = formatErrors(errors, schema, schemaRefRegistry, nodeData);
      formatted.forEach(({ message }) => {
        console.log(`      ${message}`);
      });
    });
  }

  if (result.refErrors.length > 0) {
    console.log(`\nBroken links:`);
    result.refErrors.forEach(({ file, line, parent, error }) => {
      const loc = line !== undefined ? `:${line}` : '';
      console.log(`   ${file}${loc}: ${parent} → ${error}`);
    });
  }

  if (result.duplicateErrors.length > 0) {
    console.log(`\nDuplicate keys (same title in multiple files):`);
    result.duplicateErrors.forEach(({ title, files }) => {
      console.log(`   "${title}":`);
      for (const f of files) {
        console.log(`      ${f}`);
      }
    });
  }

  if (result.ruleViolations.length > 0) {
    console.log(`\nRule violations:`);

    const severityColor: Record<RuleSeverity, string> = { error: red, warning: yellow, info: reset };
    for (const severity of ['error', 'warning', 'info'] as const) {
      const violations = result.ruleViolations.filter((v) => v.severity === severity);
      if (violations.length === 0) continue;
      console.log(`  ${severityColor[severity]}${severity.toUpperCase()}${reset} (${violations.length}):`);
      for (const v of violations) {
        console.log(`    ${v.file ? `${v.file}: ` : ''}${v.description} [${v.category}: ${v.ruleId}]`);
        if (v.evidence) {
          console.log(`      Evidence: ${v.evidence}`);
        }
        if (v.guidance) {
          console.log(`      Guidance: ${v.guidance}`);
        }
      }
    }
  }

  if (result.semanticEvaluations && result.semanticEvaluations.length > 0) {
    const passed = result.semanticEvaluations.filter((e) => e.pass).length;
    const failed = result.semanticEvaluations.filter((e) => !e.pass).length;
    console.log(
      `\nSemantic evaluations: ${result.semanticEvaluations.length} total (${passed} passed, ${failed} failed)`,
    );
  }
  if (result.gatedRules && result.gatedRules.length > 0) {
    console.log(`Gated semantic rules (skipped due to upstream errors): ${result.gatedRules.length}`);
  }

  if (result.hierarchyViolations.length > 0) {
    console.log(`\nHierarchy violations:`);
    for (const v of result.hierarchyViolations) {
      console.log(`   ${v.file}: ${v.description}`);
    }
  }

  if (result.coverageGates.length > 0) {
    console.log(`\nCoverage — rule checks gated by cascade (use --include-gated to evaluate anyway):`);
    for (const gate of result.coverageGates) {
      const cause = gate.reason === 'rule' ? `blocking rule "${gate.ruleId}"` : `${gate.reason} failure`;
      console.log(`   ${gate.file} (${gate.nodeTitle}) — ${cause} gated ${gate.gatedFiles.length} node(s):`);
      for (const file of gate.gatedFiles) console.log(`      ${file}`);
    }
  }

  if (result.skippedByDepth.length > 0) {
    console.log(`\nSkipped by depth limit (--depth ${result.depthLimit}):`);
    for (const { file } of result.skippedByDepth) console.log(`   ${file}`);
  }

  console.log(`\n`);

  if (
    result.nodeErrorCount > 0 ||
    result.refErrors.length > 0 ||
    result.duplicateErrors.length > 0 ||
    ruleCounts.error > 0 ||
    result.hierarchyViolations.length > 0 ||
    parseIssueErrorCount > 0
  ) {
    return 1;
  }
  return 0;
}

export async function watchValidate(context: SpaceContext): Promise<never> {
  const spacePath = context.space.path;
  const schemaPath = context.resolvedSchemaPath;
  const configFiles = Array.from(getConfigSourceFiles());
  const schemaDir = dirname(schemaPath);
  const schemaDirs = [bundledSchemasDir];
  if (schemaDir !== bundledSchemasDir) {
    schemaDirs.push(schemaDir);
  }
  const pluginSources = resolveSpacePluginSchemas(context.space, context.config, context.configDir);
  for (const ps of pluginSources) {
    if (!schemaDirs.includes(ps.schemasDir)) {
      schemaDirs.push(ps.schemasDir);
    }
  }

  console.log(`👀 Watching for changes...`);
  console.log(`   Config files: ${configFiles.join(', ')}`);
  console.log(`   Schema dirs: ${schemaDirs.join(', ')}`);
  console.log(`   Space:  ${spacePath}`);
  console.log(`   Press Ctrl+C to stop\n`);

  process.stdout.write('\x1b[s');

  let exitCode = 0;
  const innerValidate = async () => {
    try {
      exitCode = await validate(context);
    } catch (error) {
      console.error(`❌ Error during validation: ${error instanceof Error ? error.message : String(error)}`);
      exitCode = 2;
    }
  };
  await innerValidate();

  const watchPaths = [...configFiles, ...schemaDirs, spacePath];

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  const handleFileChange = async (filePath: string, action: string) => {
    process.stdout.write('\x1b[u\x1b[0J');
    console.log(`🔄 ${filePath} ${action}, re-validating...\n`);
    await innerValidate();
  };

  watcher.on('add', (path) => handleFileChange(path, 'added'));
  watcher.on('change', (path) => handleFileChange(path, 'changed'));
  watcher.on('unlink', (path) => handleFileChange(path, 'removed'));
  watcher.on('error', (error) => {
    console.error(`Watcher error: ${error}`);
  });

  return new Promise((_, reject) => {
    process.on('SIGINT', () => {
      console.log('\n\n👋 Stopping watch mode...');
      watcher.close();
      process.exit(exitCode);
    });
    process.on('uncaughtException', reject);
  });
}
