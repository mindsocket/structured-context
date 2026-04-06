import { isAbsolute, relative, resolve } from 'node:path';
import type { Config, SpaceConfig } from '../config';
import { getSpaceConfigDir, loadConfig, resolveSchema } from '../config';
import { readSpace } from '../read/read-space';
import { loadSchema } from '../schema/schema';
import { validateGraph } from '../schema/validate-graph';
import { validateRules } from '../schema/validate-rules';
import type { SpaceContext } from '../types';
import { formatErrors } from './validate';

export interface FileValidationResult {
  file: string;
  label: string;
  space: string;
  /** Errors keyed by composite id (e.g. `schema:/status:enum:active`, `rule:my-rule-id`). */
  errors: Record<string, { kind: string; message: string }>;
  errorCount: number;
  inSpace: true;
}

export interface FileNotInSpaceResult {
  file: string;
  inSpace: false;
  message: string;
}

export type ValidateFileOutput = FileValidationResult | FileNotInSpaceResult;

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
 * errors to only those attributable to the target file. Exits 0 if the file is
 * not in any configured space (not an error — hooks call this on all file writes).
 */
export async function validateFile(filePath: string, options: { json?: boolean } = {}): Promise<number> {
  const config = loadConfig();
  const resolved = resolveFileSpace(filePath, config);

  if (!resolved) {
    const result: FileNotInSpaceResult = {
      file: filePath,
      inSpace: false,
      message: 'File does not belong to any configured space.',
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    return 0;
  }

  const { space, label } = resolved;
  const context = buildContextForSpace(space, config);
  const { schema, schemaRefRegistry, schemaValidator } = context;
  const metadata = schema.metadata;

  const readResult = await readSpace(context);
  const { nodes } = readResult;

  const errors: Record<string, { kind: string; message: string }> = {};

  // Schema validation errors for this node
  for (const node of nodes) {
    if (node.label !== label) continue;
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

  const result: FileValidationResult = {
    file: isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath),
    label,
    space: space.name,
    errors,
    errorCount: Object.keys(errors).length,
    inSpace: true,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanReadable(result);
  }

  return Object.keys(errors).length > 0 ? 1 : 0;
}

function printHumanReadable(result: FileValidationResult): void {
  const reset = '\x1b[0m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';

  if (result.errorCount === 0) {
    console.log(`${green}✓${reset} ${result.label} (space: ${result.space})`);
    return;
  }

  console.log(`\n${red}✗${reset} ${result.label} (space: ${result.space}) — ${result.errorCount} error(s)\n`);
  for (const { kind, message } of Object.values(result.errors)) {
    console.log(`  [${kind}] ${message}`);
  }
  console.log('');
}
