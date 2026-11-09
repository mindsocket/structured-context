import { dirname } from 'node:path';
import chokidar from 'chokidar';
import { getConfigSourceFiles } from '../config';
import { resolveSpacePluginSchemas } from '../plugins/util';
import { bundledSchemasDir } from '../schema/schema';
import type { RuleSeverity, SpaceContext } from '../types';
import { formatSource, nodeIssues, type ValidateSpaceOptions, validateSpace } from '../validate';

/** What `validate --json` prints. The Claude Code plugin's scripts read it by this type. */
export type ValidateJsonOutput = ReturnType<typeof validateJson>;

function validateJson(
  context: SpaceContext,
  result: Awaited<ReturnType<typeof validateSpace>>,
  options: ValidateSpaceOptions,
) {
  const issues = nodeIssues(result, options);
  const nodeErrorCount = Object.values(issues)
    .flatMap((byKey) => Object.values(byKey))
    .filter((issue) => issue.severity === 'error').length;
  const globalRuleErrorCount = result.ruleViolations.filter((v) => !v.nodeId && v.severity === 'error').length;
  const parseErrorCount = result.parseIssues.filter((i) => i.severity === 'error').length;
  const errorCount = nodeErrorCount + parseErrorCount + globalRuleErrorCount;
  return {
    space: context.space.name,
    valid: errorCount === 0,
    validCount: result.validCount,
    errorCount,
    issues,
    ruleViolations: result.ruleViolations,
    orphanCount: result.orphans.length,
    parseIssues: result.parseIssues,
    unresolvedContentLinks: result.unresolvedContentLinks,
    coverageGates: result.coverageGates,
    contextTrimmed: result.contextTrimmed,
    skippedByDepth: result.skippedByDepth,
    depthLimit: result.depthLimit,
  };
}

export async function validate(
  context: SpaceContext,
  options: { json?: boolean } & ValidateSpaceOptions = {},
): Promise<number> {
  const result = await validateSpace(context, options);
  const ruleCounts: Record<RuleSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const v of result.ruleViolations) ruleCounts[v.severity]++;

  if (options.json) {
    const output = validateJson(context, result, options);
    console.log(JSON.stringify(output, null, 2));
    return output.valid ? 0 : 1;
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

  const parseIssueErrorCount = result.parseIssues.filter((i) => i.severity === 'error').length;

  if (result.orphans.length > 0) {
    console.log(`\nOrphans (hierarchy nodes - no parent):`);
    for (const node of result.orphans) console.log(`   ${node.id}`);
  }

  if (result.unresolvedContentLinks.length > 0) {
    console.log(`\nUnresolved content links (may be outside-space or broken):`);
    const byFile = new Map<string, string[]>();
    for (const { nodeId, target } of result.unresolvedContentLinks) {
      if (!byFile.has(nodeId)) byFile.set(nodeId, []);
      byFile.get(nodeId)!.push(target);
    }
    for (const [nodeId, targets] of byFile) {
      console.log(`   ${nodeId}:`);
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
    result.nodeErrors.forEach(({ nodeId, source, issues }) => {
      console.log(`\n   ${source ? formatSource(source) : nodeId}:`);
      issues.forEach(({ message }) => {
        console.log(`      ${message}`);
      });
    });
  }

  if (result.refErrors.length > 0) {
    console.log(`\nBroken links:`);
    result.refErrors.forEach(({ nodeId, source, parent, error }) => {
      console.log(`   ${source ? formatSource(source) : nodeId}: ${parent} → ${error}`);
    });
  }

  if (result.duplicateErrors.length > 0) {
    console.log(`\nDuplicate ids (same id on multiple nodes):`);
    result.duplicateErrors.forEach(({ id, sources }) => {
      console.log(`   "${id}":`);
      for (const source of sources) {
        console.log(`      ${formatSource(source)}`);
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
        console.log(`    ${v.nodeId ? `${v.nodeId}: ` : ''}${v.description} [${v.category}: ${v.ruleId}]`);
        if (v.evidence) {
          console.log(`      Evidence: ${v.evidence}`);
        }
        if (v.guidance) {
          console.log(`      Guidance: ${v.guidance}`);
        }
      }
    }
  }

  if (result.hierarchyViolations.length > 0) {
    console.log(`\nHierarchy violations:`);
    for (const v of result.hierarchyViolations) {
      console.log(`   ${v.nodeId}: ${v.description}`);
    }
  }

  if (result.coverageGates.length > 0) {
    console.log(`\nCoverage — rule checks gated by cascade (use --include-gated to evaluate anyway):`);
    for (const gate of result.coverageGates) {
      const cause = gate.reason === 'rule' ? `blocking rule "${gate.ruleId}"` : `${gate.reason} failure`;
      console.log(`   ${gate.nodeId} — ${cause} gated ${gate.gatedNodeIds.length} node(s):`);
      for (const nodeId of gate.gatedNodeIds) console.log(`      ${nodeId}`);
    }
  }

  if (result.skippedByDepth.length > 0) {
    console.log(`\nSkipped by depth limit (--depth ${result.depthLimit}):`);
    for (const { nodeId } of result.skippedByDepth) console.log(`   ${nodeId}`);
  }

  if (result.contextTrimmed.nodeCount > 0) {
    console.log(
      `\nContext trimmed for ${result.contextTrimmed.nodeCount} node(s) across rules ${result.contextTrimmed.ruleIds.join(', ')}.`,
    );
  }

  // Last, so a truncated tail (`| tail`) still shows the counts.
  console.log(`\nSpace Validation Results`);
  console.log(`━`.repeat(45));
  console.log('Content and structure');
  console.log(fmt('  Valid', result.validCount));
  console.log(fmt('  Schema validation errors', result.nodeErrorCount, true));
  console.log(fmt('  Broken links', result.refErrors.length, true));
  console.log(fmt('  Duplicate ids', result.duplicateErrors.length, true));
  console.log(fmt('  Rule violations (error)', ruleCounts.error, true));
  console.log(fmt('  Rule violations (warning)', ruleCounts.warning, true, true));
  console.log(fmt('  Rule violations (info)', ruleCounts.info, true, true));
  console.log(fmt('  Hierarchy violations', result.hierarchyViolations.length, true));
  console.log(fmt('  Orphans (hierarchy nodes - no parent)', result.orphans.length, true, true));
  console.log(fmt('  Unresolved content links (info)', result.unresolvedContentLinks.length, true, true));
  console.log(fmt('  Excluded during parsing', result.parseIssues.length, true, parseIssueErrorCount === 0));
  if (result.depthLimit !== undefined) {
    console.log(fmt('  Skipped by depth limit', result.skippedByDepth.length, true, true));
  }
  const gatedFileCount = result.coverageGates.reduce((sum, g) => sum + g.gatedNodeIds.length, 0);
  console.log(fmt('  Rule checks gated (cascade)', gatedFileCount, true, true));

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
