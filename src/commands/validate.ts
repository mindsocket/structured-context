import { dirname } from 'node:path';
import type { ErrorObject } from 'ajv';
import chokidar from 'chokidar';
import { getConfigSourceFiles } from '../config';
import { readSpace } from '../read/read-space';
import { bundledSchemasDir, extractEntityInfo } from '../schema/schema';
import { validateGraph } from '../schema/validate-graph';
import { validateRules } from '../schema/validate-rules';
import { buildSpaceGraph } from '../space-graph';
import type { GraphViolation, ParseIssue, RuleViolation, SchemaWithMetadata, SpaceContext, SpaceNode } from '../types';

export interface FormattedError {
  message: string;
  dedupeKey: string;
}

interface ValidationResult {
  validCount: number;
  nodeErrorCount: number;
  nodeErrors: Array<{ file: string; errors: ErrorObject[]; nodeData: Record<string, unknown> }>;
  refErrors: Array<{ file: string; parent: string; error: string }>;
  duplicateErrors: Array<{ title: string; files: string[] }>;
  ruleViolations: RuleViolation[];
  hierarchyViolations: GraphViolation[];
  orphans: SpaceNode[];
  parseIssues: ParseIssue[];
}

/**
 * Format AJV errors for better readability.
 * Groups related errors and extracts helpful context like allowed values.
 */
export function formatErrors(
  errors: ErrorObject[],
  schema: SchemaWithMetadata,
  schemaRefRegistry: Parameters<typeof extractEntityInfo>[1],
  nodeData: Record<string, unknown>,
): FormattedError[] {
  const formatted: FormattedError[] = [];
  const seen = new Set<string>();

  // Group errors by instancePath
  const byPath = new Map<string, ErrorObject[]>();
  for (const err of errors) {
    const path = err.instancePath || 'root';
    if (!byPath.has(path)) {
      byPath.set(path, []);
    }
    byPath.get(path)!.push(err);
  }

  for (const [path, pathErrors] of byPath) {
    // Check if this is a oneOf failure at root - extract valid types from schema
    const isRootOneOf = path === 'root' || path === '/type';
    let hasOneOfContext = false;
    if (isRootOneOf && pathErrors.length > 1) {
      hasOneOfContext = Array.isArray(schema.oneOf);

      if (hasOneOfContext) {
        const entities = extractEntityInfo(schema, schemaRefRegistry);
        const validTypes = entities.map((e) => e.type).sort();

        if (validTypes.length > 0) {
          const actualValue = nodeData.type;
          // Only show type error if the actual type is NOT in the valid types list
          if (actualValue !== undefined && !validTypes.includes(String(actualValue))) {
            const message = `Invalid type "${actualValue}". Valid types are: ${validTypes.join(', ')}`;
            const key = `type:${validTypes.join(',')}`;
            if (!seen.has(key)) {
              seen.add(key);
              formatted.push({ message, dedupeKey: key });
            }
          }
        }
      }
    }

    // Handle individual errors
    for (const err of pathErrors) {
      // Skip individual type const/enum errors when in oneOf context (we handle it above)
      if (
        hasOneOfContext &&
        (err.keyword === 'const' || err.keyword === 'enum') &&
        (err.instancePath === '' || err.instancePath === '/type')
      ) {
        continue;
      }

      const parts = err.instancePath.split('/').filter(Boolean);
      const fieldName = parts.length > 0 ? parts[parts.length - 1]! : 'root';

      let message = err.message;
      let key = `${err.instancePath}:${err.keyword}`;

      // Enhance const errors
      if (err.keyword === 'const' && err.params?.allowedValue !== undefined) {
        const actual = err.data !== undefined ? `"${err.data}"` : 'missing value';
        const expected = `"${err.params.allowedValue}"`;
        message = `${fieldName}: expected ${expected}, got ${actual}`;
        key = `${err.instancePath}:const:${err.params.allowedValue}`;
      }
      // Enhance enum errors
      else if (err.keyword === 'enum' && err.params?.allowedValues && Array.isArray(err.params.allowedValues)) {
        let actual = err.data !== undefined ? `"${err.data}"` : null;
        // If err.data is undefined, try to get the value from nodeData using the field name
        if (actual === null && fieldName !== 'root') {
          const actualValue = nodeData[fieldName];
          if (actualValue !== undefined) {
            actual = `"${actualValue}"`;
          }
        }
        if (actual === null) {
          actual = 'missing value';
        }
        const allowed = err.params.allowedValues.map((v: unknown) => `"${v}"`).join(', ');
        message = `${fieldName}: ${actual} is not valid. Allowed: ${allowed}`;
        key = `${err.instancePath}:enum:${err.params.allowedValues.join(',')}`;
      }
      // Generic message with path
      else {
        message = `${fieldName}: ${err.message}`;
      }

      if (!seen.has(key)) {
        seen.add(key);
        formatted.push({ message, dedupeKey: key });
      }
    }
  }

  return formatted;
}

export async function validate(context: SpaceContext, options: { json?: boolean } = {}): Promise<number> {
  const { schema, schemaRefRegistry, schemaValidator } = context;
  const metadata = schema.metadata;

  const readResult = await readSpace(context);
  const { nodes, parseIssues } = readResult;

  // Pre-extract valid types for early type validation
  const validTypes = Array.isArray(schema.oneOf) ? extractEntityInfo(schema, schemaRefRegistry).map((e) => e.type) : [];

  const result: ValidationResult = {
    validCount: 0,
    nodeErrorCount: 0,
    nodeErrors: [],
    refErrors: [],
    duplicateErrors: [],
    ruleViolations: [],
    hierarchyViolations: [],
    orphans: [],
    parseIssues,
  };

  for (const node of nodes) {
    // Early type validation - check before full AJV validation to prevent cascading errors
    const nodeType = (node.schemaData as Record<string, unknown>).type as string | undefined;
    if (nodeType !== undefined && validTypes.length > 0 && !validTypes.includes(nodeType)) {
      result.nodeErrorCount++;
      result.nodeErrors.push({
        file: node.label,
        errors: [
          {
            instancePath: '/type',
            keyword: 'enum',
            message: `Invalid type "${nodeType}". Valid types are: ${validTypes.sort().join(', ')}`,
            params: { allowedValues: validTypes },
            schemaPath: '#/oneOf',
            data: nodeType,
          } as ErrorObject,
        ],
        nodeData: node.schemaData as Record<string, unknown>,
      });
      continue;
    }

    const valid = schemaValidator(node.schemaData);

    if (valid) {
      result.validCount++;
    } else {
      result.nodeErrorCount++;
      result.nodeErrors.push({
        file: node.label,
        errors: schemaValidator.errors || [],
        nodeData: node.schemaData as Record<string, unknown>,
      });
    }
  }

  // Detect duplicate node keys (titles)
  const titleToFiles = new Map<string, string[]>();
  for (const node of nodes) {
    const title = node.title;
    if (!titleToFiles.has(title)) {
      titleToFiles.set(title, []);
    }
    titleToFiles.get(title)!.push(node.label);
  }

  for (const [title, files] of titleToFiles) {
    if (files.length > 1) {
      result.duplicateErrors.push({ title, files });
    }
  }

  // Validate all hierarchy constraints (field references and structure)
  const hierarchyValidation = validateGraph(nodes, metadata, readResult.unresolvedRefs);

  result.refErrors.push(...hierarchyValidation.refErrors);
  result.hierarchyViolations = [...hierarchyValidation.violations];

  // Calculate orphan count (informational, not a validation error)
  if (metadata.hierarchy) {
    result.orphans = [...buildSpaceGraph(nodes, metadata.hierarchy.levels).orphans];
  }

  // Load and execute rules validation if schema defines rules
  if (metadata.rules) {
    result.ruleViolations = await validateRules(nodes, metadata.rules);
  }

  // JSON output mode
  if (options.json) {
    const errorsByFile: Record<string, Record<string, { kind: string; message: string }>> = {};

    const addError = (file: string, key: string, kind: string, message: string) => {
      if (!errorsByFile[file]) errorsByFile[file] = {};
      errorsByFile[file][key] = { kind, message };
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
      if (v.file) {
        addError(v.file, `rule:${v.ruleId}`, 'rule', `[${v.ruleId}] ${v.description}`);
      }
    }
    for (const v of result.hierarchyViolations) {
      addError(v.file, `hierarchy:${v.description}`, 'hierarchy', v.description);
    }

    const parseErrorCount = result.parseIssues.filter((i) => i.severity === 'error').length;
    const errorCount =
      Object.values(errorsByFile).reduce((sum, errs) => sum + Object.keys(errs).length, 0) + parseErrorCount;
    console.log(
      JSON.stringify(
        {
          space: context.space.name,
          valid: errorCount === 0,
          validCount: result.validCount,
          errorCount,
          errors: errorsByFile,
          orphanCount: result.orphans.length,
          parseIssues: result.parseIssues,
        },
        null,
        2,
      ),
    );
    return errorCount > 0 ? 1 : 0;
  }

  // Report
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
      // For non-error items (like "Valid"), green if count > 0, red if 0
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
  console.log(fmt('  Rule violations', result.ruleViolations.length, true));
  console.log(fmt('  Hierarchy violations', result.hierarchyViolations.length, true));
  console.log(fmt('  Orphans (hierarchy nodes - no parent)', result.orphans.length, true, true));
  const parseIssueErrorCount = result.parseIssues.filter((i) => i.severity === 'error').length;
  console.log(fmt('  Excluded during parsing', result.parseIssues.length, true, parseIssueErrorCount === 0));

  if (result.orphans.length > 0) {
    console.log(`\nOrphans (hierarchy nodes - no parent):`);
    for (const node of result.orphans) console.log(`   ${node.label}`);
  }

  if (result.parseIssues.length > 0) {
    console.log(`\nExcluded during parsing:`);
    for (const issue of result.parseIssues) {
      const detail = issue.message ? ` - ${issue.message}` : '';
      console.log(`   ${issue.file}: ${issue.severity} - ${issue.type}${detail}`);
    }
  }

  if (result.nodeErrors.length > 0) {
    console.log(`\nSchema validation errors:`);
    result.nodeErrors.forEach(({ file, errors, nodeData }) => {
      console.log(`\n   ${file}:`);
      const formatted = formatErrors(errors, schema, schemaRefRegistry, nodeData);
      formatted.forEach(({ message }) => {
        console.log(`      ${message}`);
      });
    });
  }

  if (result.refErrors.length > 0) {
    console.log(`\nBroken links:`);
    result.refErrors.forEach(({ file, parent, error }) => {
      console.log(`   ${file}: ${parent} → ${error}`);
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

    // Group by category
    const byCategory = new Map<string, RuleViolation[]>();
    for (const v of result.ruleViolations) {
      if (!byCategory.has(v.category)) {
        byCategory.set(v.category, []);
      }
      byCategory.get(v.category)!.push(v);
    }

    // Report each category
    for (const [category, violations] of byCategory) {
      console.log(`  ${category.toUpperCase()} (${violations.length}):`);
      for (const v of violations) {
        console.log(`    ${v.file ? `${v.file}: ` : ''}${v.description}`);
      }
    }
  }

  if (result.hierarchyViolations.length > 0) {
    console.log(`\nHierarchy violations:`);
    for (const v of result.hierarchyViolations) {
      console.log(`   ${v.file}: ${v.description}`);
    }
  }

  console.log(`\n`);

  // Return exit code (0 for success, 1 for validation failures)
  if (
    result.nodeErrorCount > 0 ||
    result.refErrors.length > 0 ||
    result.duplicateErrors.length > 0 ||
    result.ruleViolations.length > 0 ||
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

  console.log(`👀 Watching for changes...`);
  console.log(`   Config files: ${configFiles.join(', ')}`);
  console.log(`   Schema dirs: ${schemaDirs.join(', ')}`);
  console.log(`   Space:  ${spacePath}`);
  console.log(`   Press Ctrl+C to stop\n`);

  // Save cursor position after header (for clearing later)
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
    // Restore cursor to header position and clear everything below
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

  // Keep process alive
  return new Promise((_, reject) => {
    process.on('SIGINT', () => {
      console.log('\n\n👋 Stopping watch mode...');
      watcher.close();
      process.exit(exitCode);
    });
    process.on('uncaughtException', reject);
  });
}
