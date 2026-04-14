import { isAbsolute, relative, resolve } from 'node:path';
import type { ErrorObject } from 'ajv';
import type { Config, SpaceConfig } from './config';
import { getSpaceConfigDir, resolveSchema } from './config';
import { readSpace } from './read/read-space';
import { extractEntityInfo, loadSchema } from './schema/schema';
import { validateGraph } from './schema/validate-graph';
import { validateRules } from './schema/validate-rules';
import { buildSpaceGraph } from './space-graph';
import type {
  FileNotInSpaceResult,
  FileValidationResult,
  GraphViolation,
  ParseIssue,
  RuleViolation,
  SchemaWithMetadata,
  SpaceContext,
  SpaceNode,
  ValidateFileOutput,
} from './types';

export interface FormattedError {
  message: string;
  dedupeKey: string;
}

export interface ValidationResult {
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

/**
 * Run full validation on a space and return a structured result.
 * Does not output to console or call process.exit.
 */
export async function validateSpace(context: SpaceContext): Promise<ValidationResult> {
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

  return result;
}

/** Find which space a file belongs to by checking directory containment. */
function resolveFileSpace(filePath: string, config: Config): { space: SpaceConfig; label: string } | null {
  const absFile = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);

  for (const space of config.spaces) {
    const absSpace = isAbsolute(space.path) ? space.path : resolve(process.cwd(), space.path);
    // Trailing slash prevents prefix-match false positives (e.g. /foo matching /foobar/)
    const spaceDir = absSpace.endsWith('/') ? absSpace : `${absSpace}/`;
    if (absFile.startsWith(spaceDir) || absFile === absSpace) {
      return { space, label: relative(absSpace, absFile) };
    }
  }
  return null;
}

function buildContextForSpace(space: SpaceConfig, config: Config): SpaceContext {
  const resolvedSchemaPath = resolveSchema(config, space);
  const { schema, schemaRefRegistry, schemaValidator } = loadSchema(resolvedSchemaPath);
  const configDir = getSpaceConfigDir(space.name);
  return { space, config, resolvedSchemaPath, schema, schemaRefRegistry, schemaValidator, configDir };
}

/**
 * Validate a single file within its space.
 *
 * Reads the full space (required for graph correctness) but filters all reported
 * errors to only those attributable to the target file.
 *
 * Returns a result object — does not output to console or call process.exit.
 * If the file is not in any configured space, returns a result with `inSpace: false`.
 */
export async function validateFile(filePath: string, config: Config): Promise<ValidateFileOutput> {
  const resolved = resolveFileSpace(filePath, config);

  if (!resolved) {
    return {
      file: filePath,
      inSpace: false,
      message: 'File does not belong to any configured space.',
    } satisfies FileNotInSpaceResult;
  }

  const { space, label } = resolved;
  const context = buildContextForSpace(space, config);
  const { schema, schemaRefRegistry, schemaValidator } = context;
  const metadata = schema.metadata;

  const readResult = await readSpace(context);
  const { nodes } = readResult;

  // Pre-extract valid types for early type validation
  const validTypes = Array.isArray(schema.oneOf) ? extractEntityInfo(schema, schemaRefRegistry).map((e) => e.type) : [];

  const errors: Record<string, { kind: string; message: string }> = {};

  // Schema validation errors for this node
  for (const node of nodes) {
    if (node.label !== label) continue;

    // Early type validation - check before full AJV validation to prevent cascading errors
    const nodeType = (node.schemaData as Record<string, unknown>).type as string | undefined;
    if (nodeType !== undefined && validTypes.length > 0 && !validTypes.includes(nodeType)) {
      errors[`schema:type:${validTypes.join(',')}`] = {
        kind: 'schema',
        message: `Invalid type "${nodeType}". Valid types are: ${validTypes.sort().join(', ')}`,
      };
      continue;
    }

    const valid = schemaValidator(node.schemaData);
    if (!valid) {
      const formatted = formatErrors(
        schemaValidator.errors ?? [],
        schema,
        schemaRefRegistry,
        node.schemaData as Record<string, unknown>,
      );
      for (const { message, dedupeKey } of formatted) {
        errors[`schema:${dedupeKey}`] = { kind: 'schema', message };
      }
    }
  }

  // Duplicate key errors — include if this file is one of the duplicates
  const titleToFiles = new Map<string, string[]>();
  for (const node of nodes) {
    if (!titleToFiles.has(node.title)) titleToFiles.set(node.title, []);
    titleToFiles.get(node.title)!.push(node.label);
  }
  for (const [title, files] of titleToFiles) {
    if (files.length > 1 && files.includes(label)) {
      const others = files.filter((f) => f !== label);
      errors[`duplicate:${title}`] = {
        kind: 'duplicate',
        message: `Duplicate title "${title}" also exists in: ${others.join(', ')}`,
      };
    }
  }

  // Broken links and hierarchy violations from this file
  const hierarchyValidation = validateGraph(nodes, metadata, readResult.unresolvedRefs);
  for (const { file, parent, error } of hierarchyValidation.refErrors) {
    if (file === label) {
      errors[`broken-link:${parent}`] = { kind: 'broken-link', message: `${parent} → ${error}` };
    }
  }
  for (const v of hierarchyValidation.violations) {
    if (v.file === label) {
      errors[`hierarchy:${v.description}`] = { kind: 'hierarchy', message: v.description };
    }
  }

  // Rule violations for this node
  if (metadata.rules) {
    const ruleViolations = await validateRules(nodes, metadata.rules);
    for (const v of ruleViolations) {
      if (v.file === label) {
        errors[`rule:${v.ruleId}`] = { kind: 'rule', message: `[${v.ruleId}] ${v.description}` };
      }
    }
  }

  return {
    file: isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath),
    label,
    space: space.name,
    errors,
    errorCount: Object.keys(errors).length,
    inSpace: true,
  } satisfies FileValidationResult;
}
