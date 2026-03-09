import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnySchemaObject, SchemaObject } from 'ajv';
import Ajv, { type ValidateFunction } from 'ajv';
import JSON5 from 'json5';
import type { HierarchyLevel, RulesMetadata, SchemaMetadata } from './types';

const packageDir = dirname(fileURLToPath(import.meta.url));
export const bundledSchemasDir = join(packageDir, '..', 'schemas');
/** Parsed JSON schema object — always a plain object (never a boolean schema). */
type JsonSchemaObject = Record<string, unknown>;

export function readRawSchema(schemaPath: string): JsonSchemaObject {
  return JSON5.parse(readFileSync(resolve(schemaPath), 'utf-8')) as JsonSchemaObject;
}

/**
 * Build a registry of all schemas in the given directory, keyed by $id.
 * Only loads "partial" schemas (starting with _) and an optional target file.
 */
function buildSchemaRegistry(dir: string, targetFile?: string): Map<string, JsonSchemaObject> {
  const registry = new Map<string, JsonSchemaObject>();
  if (!existsSync(dir)) return registry;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const isPartial = file.startsWith('_');
    const isTarget = targetFile !== undefined && file === targetFile;
    if (!isPartial && !isTarget) continue;

    const schema = readRawSchema(join(dir, file));
    if (typeof schema.$id === 'string') registry.set(schema.$id, schema);
  }
  return registry;
}

/**
 * Build the full two-layer registry for a schema path:
 * - Layer 1: bundled schemas/ dir (partials only, as fallback)
 * - Layer 2: schema's own dir (partials + target file) — overrides layer 1
 * Does not throw on $id collision; layer 2 silently wins.
 */
export function buildFullRegistry(schemaPath: string): Map<string, JsonSchemaObject> {
  const absPath = resolve(schemaPath);
  const targetFile = basename(absPath);
  const targetDir = dirname(absPath);

  const registry = new Map<string, JsonSchemaObject>();

  // Layer 1: bundled schemas/ dir (partials only)
  for (const [id, schema] of buildSchemaRegistry(bundledSchemasDir)) {
    registry.set(id, schema);
  }

  // Layer 2: schema's own dir (partials + target file)
  if (targetDir !== bundledSchemasDir) {
    const bundledIds = new Set(registry.keys());
    for (const [id, schema] of buildSchemaRegistry(targetDir, targetFile)) {
      if (bundledIds.has(id)) {
        throw new Error(
          `Schema collision: partial schema in ${targetDir} uses $id "${id}" which is reserved by a default schema. Please use a unique $id for local partials.`,
        );
      }
      registry.set(id, schema);
    }
  }

  return registry;
}

/**
 * Compile a schema into an AJV ValidateFunction using the registry approach.
 * All peer schemas in the same directory are registered so AJV can resolve
 * cross-file $refs transitively.
 * Also registers schemas from the default schemas/ directory as a fallback.
 */
export function createValidator(schemaPath: string): ValidateFunction {
  const targetSchema = readRawSchema(schemaPath);
  const ajv = new Ajv();

  const registry = buildFullRegistry(schemaPath);

  // Register all except target schema (AJV compiles targetSchema explicitly)
  for (const [id, schema] of registry) {
    if (id === targetSchema.$id) continue;
    ajv.addSchema(schema);
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
        const path = hashPath.replace(/^\//, '').split('/');
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

/**
 * Merge properties and required fields from allOf refs and direct variant properties.
 * allOf entries are resolved via resolveRef; direct properties take precedence.
 */
export function mergeVariantProperties(
  variant: AnySchemaObject,
  schema: SchemaObject,
  registry: Map<string, AnySchemaObject>,
): { properties: Record<string, AnySchemaObject>; required: string[] } {
  const properties: Record<string, AnySchemaObject> = {};
  const required: string[] = [];

  for (const sub of (variant.allOf as AnySchemaObject[] | undefined) ?? []) {
    const resolved = resolveRef(sub, schema, registry);
    Object.assign(properties, resolved?.properties ?? {});
    required.push(...((resolved?.required ?? []) as string[]));
  }

  Object.assign(properties, variant.properties ?? {});
  required.push(...((variant.required ?? []) as string[]));

  return { properties, required: [...new Set(required)] };
}

export function resolveNodeType(type: string, aliases: Record<string, string> | undefined): string {
  return aliases?.[type] ?? type;
}

export function loadMetadata(schemaPath: string): SchemaMetadata {
  const schema = readRawSchema(schemaPath);
  let metadata = (schema.$defs as Record<string, unknown>)?._metadata as Record<string, unknown> | undefined;

  // _metadata may live in a partial schema rather than the target
  if (!metadata) {
    for (const s of buildFullRegistry(schemaPath).values()) {
      const m = (s.$defs as Record<string, unknown> | undefined)?._metadata;
      if (m) {
        metadata = m as Record<string, unknown>;
        break;
      }
    }
  }

  const rawHierarchy = metadata?.hierarchy as Array<string | Record<string, unknown>> | undefined;
  if (!rawHierarchy || rawHierarchy.length === 0) {
    throw new Error(
      `Schema at ${schemaPath} must define "$defs._metadata.hierarchy" array for depth-based type inference`,
    );
  }

  const levels: HierarchyLevel[] = rawHierarchy.map((entry) => {
    if (typeof entry === 'string') {
      return { type: entry, field: 'parent', fieldOn: 'child', multiple: false, selfRef: false };
    }
    return {
      type: entry.type as string,
      field: (entry.field as string | undefined) ?? 'parent',
      fieldOn: (entry.fieldOn as string | undefined) === 'parent' ? 'parent' : 'child',
      multiple: (entry.multiple as boolean | undefined) ?? false,
      selfRef: (entry.selfRef as boolean | undefined) ?? false,
    };
  });

  const hierarchy = levels.map((l) => l.type);

  return {
    hierarchy,
    levels,
    aliases: (metadata?.aliases as Record<string, string>) ?? undefined,
    allowSkipLevels: (metadata?.allowSkipLevels as boolean) ?? undefined,
    rules: (metadata?.rules as RulesMetadata) ?? undefined,
  };
}
