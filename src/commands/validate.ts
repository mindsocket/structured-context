import type { ErrorObject } from 'ajv';
import { readSpace } from '../read/read-space';
import { buildFullRegistry, createValidator, loadMetadata, readRawSchema } from '../schema/schema';
import { validateGraph } from '../schema/validate-graph';
import { validateRules } from '../schema/validate-rules';
import type { GraphViolation, RuleViolation } from '../types';
import { classifyNodes } from '../util/graph-helpers';
import { extractEntityInfo } from './schemas';

interface FormattedError {
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
  orphanCount: number;
  skipped: string[];
  nonSpace: string[];
}

/**
 * Format AJV errors for better readability.
 * Groups related errors and extracts helpful context like allowed values.
 */
function formatErrors(errors: ErrorObject[], schemaPath: string, nodeData: Record<string, unknown>): FormattedError[] {
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
      const schema = readRawSchema(schemaPath);
      hasOneOfContext = Array.isArray(schema.oneOf);

      if (hasOneOfContext) {
        const registry = buildFullRegistry(schemaPath);
        const entities = extractEntityInfo(schema.oneOf as unknown[], registry, schema);
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

export async function validate(path: string, options: { schema: string; templateDir?: string }): Promise<number> {
  const validateFunc = createValidator(options.schema);

  const readResult = await readSpace(path, {
    schemaPath: options.schema,
    templateDir: options.templateDir,
  });
  const { nodes } = readResult;
  const skipped = readResult.kind === 'directory' ? readResult.skipped : [];
  const nonSpace = readResult.kind === 'directory' ? readResult.nonSpace : [];

  const result: ValidationResult = {
    validCount: 0,
    nodeErrorCount: 0,
    nodeErrors: [],
    refErrors: [],
    duplicateErrors: [],
    ruleViolations: [],
    hierarchyViolations: [],
    orphanCount: 0,
    skipped,
    nonSpace: nonSpace,
  };

  // Load metadata early — needed for levels-based ref validation
  const metadata = loadMetadata(options.schema);

  for (const node of nodes) {
    const valid = validateFunc(node.schemaData);

    if (valid) {
      result.validCount++;
    } else {
      result.nodeErrorCount++;
      result.nodeErrors.push({
        file: node.label,
        errors: validateFunc.errors || [],
        nodeData: node.schemaData as Record<string, unknown>,
      });
    }
  }

  // Detect duplicate node keys (titles)
  const titleToFiles = new Map<string, string[]>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
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
  const hierarchyValidation = validateGraph(nodes, metadata);

  result.refErrors.push(...hierarchyValidation.refErrors);
  result.hierarchyViolations = [...hierarchyValidation.violations];

  // Calculate orphan count (informational, not a validation error)
  if (metadata.hierarchy) {
    const classification = classifyNodes(nodes, metadata.hierarchy.levels);
    result.orphanCount = classification.orphans.length;
  }

  // Load and execute rules validation if schema defines rules
  if (metadata.rules) {
    result.ruleViolations = await validateRules(nodes, metadata.rules);
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
  console.log(fmt('  Orphans (hierarchy nodes - no parent)', result.orphanCount, true, true));
  console.log('Skipped');
  console.log(fmt('  No frontmatter', result.skipped.length, true, true));
  console.log(fmt('  No type field', result.nonSpace.length, true, true));

  if (result.skipped.length > 0) {
    console.log(`\nSkipped files (no frontmatter):`);
    for (const f of result.skipped) console.log(`   ${f}`);
  }

  if (result.nonSpace.length > 0) {
    console.log(`\nNon-space files (no type field):`);
    for (const f of result.nonSpace) console.log(`   ${f}`);
  }

  if (result.nodeErrors.length > 0) {
    console.log(`\nSchema validation errors:`);
    result.nodeErrors.forEach(({ file, errors, nodeData }) => {
      console.log(`\n   ${file}:`);
      const formatted = formatErrors(errors, options.schema, nodeData);
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
    result.hierarchyViolations.length > 0
  ) {
    return 1;
  }
  return 0;
}
