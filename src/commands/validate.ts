import { dirname } from 'node:path';
import chokidar from 'chokidar';
import { getConfigSourceFiles } from '../config';
import { resolveSpacePluginSchemas } from '../plugins/util';
import { bundledSchemasDir } from '../schema/schema';
import type { RuleSeverity, SpaceContext, ValidationIssue } from '../types';
import { formatSource, type ValidateSpaceOptions, type ValidationResult, validateSpace } from '../validate';

/** What `validate --json` prints: the run's `ValidationResult` and a summary. The Claude Code plugin's scripts read it by this type. */
export type ValidateJsonOutput = ReturnType<typeof validateJson>;

function validateJson(context: SpaceContext, result: ValidationResult) {
  const errorCount = result.issues.filter((issue) => issue.severity === 'error').length;
  return { space: context.space.name, valid: errorCount === 0, errorCount, ...result };
}

/** The issues of one kind, narrowed to that kind's fields */
function ofKind<K extends ValidationIssue['kind']>(result: ValidationResult, kind: K) {
  return result.issues.filter((issue): issue is Extract<ValidationIssue, { kind: K }> => issue.kind === kind);
}

export async function validate(
  context: SpaceContext,
  options: { json?: boolean } & ValidateSpaceOptions = {},
): Promise<number> {
  const result = await validateSpace(context, options);
  const errorCount = result.issues.filter((issue) => issue.severity === 'error').length;

  if (options.json) {
    console.log(JSON.stringify(validateJson(context, result), null, 2));
    return errorCount === 0 ? 0 : 1;
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

  const where = (issue: ValidationIssue) => (issue.source ? formatSource(issue.source) : (issue.nodeId ?? ''));
  const parseIssues = ofKind(result, 'parse');
  const schemaIssues = ofKind(result, 'schema');
  const brokenLinks = ofKind(result, 'broken-link');
  const duplicates = ofKind(result, 'duplicate');
  const ruleViolations = ofKind(result, 'rule');
  const hierarchyViolations = ofKind(result, 'hierarchy');
  const contentLinks = ofKind(result, 'content-link');
  const ruleCounts: Record<RuleSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const v of ruleViolations) ruleCounts[v.severity]++;

  if (result.orphans.length > 0) {
    console.log(`\nOrphans (hierarchy nodes - no parent):`);
    for (const { nodeId } of result.orphans) console.log(`   ${nodeId}`);
  }

  if (contentLinks.length > 0) {
    console.log(`\nUnresolved content links (may be outside-space or broken):`);
    const byNode = Map.groupBy(contentLinks, (link) => link.nodeId);
    for (const [nodeId, links] of byNode) {
      console.log(`   ${nodeId}:`);
      for (const { target } of links) console.log(`      ${target}`);
    }
  }

  if (parseIssues.length > 0) {
    console.log(`\nExcluded during parsing:`);
    for (const issue of parseIssues) {
      console.log(`   ${formatSource(issue.source)}: ${issue.severity} - ${issue.type} - ${issue.message}`);
    }
  }

  if (schemaIssues.length > 0) {
    console.log(`\nSchema validation errors:`);
    for (const [, issues] of Map.groupBy(schemaIssues, (issue) => issue.nodeId)) {
      console.log(`\n   ${where(issues[0]!)}:`);
      for (const { message } of issues) console.log(`      ${message}`);
    }
  }

  if (brokenLinks.length > 0) {
    console.log(`\nBroken links:`);
    for (const issue of brokenLinks) console.log(`   ${where(issue)}: ${issue.message}`);
  }

  if (duplicates.length > 0) {
    console.log(`\nDuplicate ids (same id on multiple nodes):`);
    for (const { nodeId, sources } of duplicates) {
      console.log(`   "${nodeId}":`);
      for (const source of sources) console.log(`      ${formatSource(source)}`);
    }
  }

  if (ruleViolations.length > 0) {
    console.log(`\nRule violations:`);

    const severityColor: Record<RuleSeverity, string> = { error: red, warning: yellow, info: reset };
    for (const severity of ['error', 'warning', 'info'] as const) {
      const violations = ruleViolations.filter((v) => v.severity === severity);
      if (violations.length === 0) continue;
      console.log(`  ${severityColor[severity]}${severity.toUpperCase()}${reset} (${violations.length}):`);
      for (const v of violations) {
        console.log(`    ${v.nodeId ? `${v.nodeId}: ` : ''}${v.message} [${v.category}: ${v.ruleId}]`);
        if (v.evidence) {
          console.log(`      Evidence: ${v.evidence}`);
        }
        if (v.guidance) {
          console.log(`      Guidance: ${v.guidance}`);
        }
      }
    }
  }

  if (hierarchyViolations.length > 0) {
    console.log(`\nHierarchy violations:`);
    for (const v of hierarchyViolations) {
      console.log(`   ${v.nodeId}: ${v.message}`);
    }
  }

  const gatedIssues = ofKind(result, 'gated');
  const byGate = Map.groupBy(gatedIssues, (issue) => issue.gatedBy);
  if (byGate.size > 0) {
    console.log(`\nRule checks gated by cascade (use --include-gated to evaluate anyway):`);
    for (const [gateNodeId, issues] of byGate) {
      console.log(`   ${gateNodeId} — gated ${issues.length} node(s):`);
      for (const { nodeId } of issues) console.log(`      ${nodeId}`);
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
  console.log(fmt('  Schema validation errors', new Set(schemaIssues.map((issue) => issue.nodeId)).size, true));
  console.log(fmt('  Broken links', brokenLinks.length, true));
  console.log(fmt('  Duplicate ids', duplicates.length, true));
  console.log(fmt('  Rule violations (error)', ruleCounts.error, true));
  console.log(fmt('  Rule violations (warning)', ruleCounts.warning, true, true));
  console.log(fmt('  Rule violations (info)', ruleCounts.info, true, true));
  console.log(fmt('  Hierarchy violations', hierarchyViolations.length, true));
  console.log(fmt('  Orphans (hierarchy nodes - no parent)', result.orphans.length, true, true));
  console.log(fmt('  Unresolved content links (info)', contentLinks.length, true, true));
  const parseErrors = parseIssues.filter((issue) => issue.severity === 'error').length;
  console.log(fmt('  Excluded during parsing', parseIssues.length, true, parseErrors === 0));
  if (result.depthLimit !== undefined) {
    console.log(fmt('  Skipped by depth limit', result.skippedByDepth.length, true, true));
  }
  console.log(fmt('  Rule checks gated (cascade)', gatedIssues.length, true, true));

  console.log(`\n`);

  return errorCount === 0 ? 0 : 1;
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
