import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AnySchemaObject, SchemaObject } from 'ajv';
import Ajv, { type ValidateFunction } from 'ajv';
import { parse } from 'jsonc-parser';
import type { RulesMetadata, SchemaMetadata } from './types';

/** Parsed JSON schema object — always a plain object (never a boolean schema). */
type JsonSchemaObject = Record<string, unknown>;

/**
 * Build a registry of all schemas in the given directory, keyed by $id.
 * Used both by createValidator (AJV) and loadSchema (template-sync bundling).
 */
export function buildSchemaRegistry(dir: string): Map<string, JsonSchemaObject> {
  const registry = new Map<string, JsonSchemaObject>();
  if (!existsSync(dir)) return registry;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const schema = parse(readFileSync(join(dir, file), 'utf-8')) as JsonSchemaObject;
    if (typeof schema.$id === 'string') registry.set(schema.$id, schema);
  }
  return registry;
}

/**
 * Load a schema as a self-contained object for direct traversal (e.g. template-sync).
 * External $refs are resolved against peer schemas in the same directory: their $defs
 * are merged in and the refs rewritten to internal #/$defs/... form.
 * Note: only one level of ref resolution is performed here. Full cross-schema traversal
 * will be addressed when template-sync is updated in #15.
 */
export function loadSchema(schemaPath: string): JsonSchemaObject {
  const absPath = resolve(schemaPath);
  const schema = parse(readFileSync(absPath, 'utf-8')) as JsonSchemaObject;
  const registry = buildSchemaRegistry(dirname(absPath));

  // Collect $defs from any externally-referenced schemas
  const mergedDefs: Record<string, unknown> = {};
  JSON.stringify(schema, (key, value) => {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
      const baseId = value.split('#')[0]!;
      const dep = registry.get(baseId);
      if (dep) Object.assign(mergedDefs, dep.$defs ?? {});
    }
    return value;
  });

  schema.$defs = { ...mergedDefs, ...(schema.$defs ?? {}) };

  // Rewrite external $refs to internal #/$defs/... refs
  return JSON.parse(
    JSON.stringify(schema, (key, value) => {
      if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
        const hashIdx = value.indexOf('#');
        return hashIdx !== -1 ? value.slice(hashIdx) : '#';
      }
      return value;
    }),
  ) as JsonSchemaObject;
}

/**
 * Compile a schema into an AJV ValidateFunction using the registry approach.
 * All peer schemas in the same directory are registered so AJV can resolve
 * cross-file $refs transitively.
 */
export function createValidator(schemaPath: string): ValidateFunction {
  const absPath = resolve(schemaPath);
  const targetSchema = parse(readFileSync(absPath, 'utf-8'));
  const ajv = new Ajv();
  for (const [id, peerSchema] of buildSchemaRegistry(dirname(absPath))) {
    if (id === targetSchema.$id) continue; // already compiled below
    ajv.addSchema(peerSchema);
  }
  return ajv.compile(targetSchema);
}

/**
 * Resolve a $ref within a schema, handling both external refs (ost-tools://...) and internal refs (#/$defs/...).
 * Used by template-sync for traversing schema structures.
 */
export function resolveRef(
  propDef: AnySchemaObject | undefined,
  schema: SchemaObject,
  registry: Map<string, AnySchemaObject>,
): AnySchemaObject | undefined {
  if (propDef?.$ref) {
    const ref = propDef.$ref as string;

    // Handle external refs (e.g., "ost-tools://_shared#/$defs/baseNodeProps")
    if (!ref.startsWith('#/')) {
      const [baseId, hashPath] = ref.split('#');
      const externalSchema = registry.get(baseId ?? '');
      if (!externalSchema) {
        throw new Error(`Cannot resolve external $ref: ${ref}`);
      }

      // Resolve the hash path in the external schema
      if (hashPath) {
        const path = hashPath.replace(/^#\//, '').split('/');
        // biome-ignore lint/suspicious/noExplicitAny: JSON schema traversal
        return path.reduce((obj: any, key: string) => obj[key], externalSchema);
      }
      return externalSchema;
    }

    // Handle internal refs (e.g., "#/$defs/baseNodeProps")
    const path = ref.replace(/^#\//, '').split('/');
    // biome-ignore lint/suspicious/noExplicitAny: JSON schema traversal
    return path.reduce((obj: any, key: string) => obj[key], schema);
  }
  return propDef;
}

export function resolveNodeType(type: string, aliases: Record<string, string> | undefined): string {
  return aliases?.[type] ?? type;
}

export function loadMetadata(schemaPath: string): SchemaMetadata {
  const schema = loadSchema(schemaPath);
  const metadata = (schema.$defs as Record<string, unknown>)?._metadata as Record<string, unknown> | undefined;

  const hierarchy = (metadata?.hierarchy as string[]) ?? undefined;
  if (!hierarchy || hierarchy.length === 0) {
    throw new Error(
      `Schema at ${schemaPath} must define "$defs._metadata.hierarchy" array for depth-based type inference`,
    );
  }

  return {
    hierarchy,
    aliases: (metadata?.aliases as Record<string, string>) ?? undefined,
    allowSkipLevels: (metadata?.allowSkipLevels as boolean) ?? undefined,
    allowSelfRef: (metadata?.allowSelfRef as string[]) ?? undefined,
    rules: (metadata?.rules as RulesMetadata) ?? undefined,
  };
}
