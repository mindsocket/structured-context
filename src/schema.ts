import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import JSON5 from 'json5';
import {
  type MetadataContract,
  type MetadataContractRules,
  OST_TOOLS_DIALECT_META_SCHEMA,
  OST_TOOLS_METADATA_SCHEMA,
  OST_TOOLS_SCHEMA_META_ID,
} from './metadata-contract';
import type { HierarchyLevel, SchemaMetadata } from './types';

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
    bundledIds.add(OST_TOOLS_SCHEMA_META_ID);
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
  ajv.addKeyword({
    keyword: '$metadata',
    schemaType: 'object',
    metaSchema: OST_TOOLS_METADATA_SCHEMA as unknown as JsonSchemaObject,
    valid: true,
    errors: false,
  });
  const metaSchema = OST_TOOLS_DIALECT_META_SCHEMA as unknown as JsonSchemaObject;
  ajv.addSchema(metaSchema, OST_TOOLS_SCHEMA_META_ID);

  const registry = buildFullRegistry(schemaPath);

  // Register all except target schema (AJV compiles targetSchema explicitly)
  for (const [id, schema] of registry) {
    if (id === targetSchema.$id || id === OST_TOOLS_SCHEMA_META_ID) continue;
    ajv.addSchema(schema);
  }

  return ajv.compile(targetSchema);
}

export function resolveNodeType(type: string, typeAliases: Record<string, string> | undefined): string {
  return typeAliases?.[type] ?? type;
}

function readTopLevelMetadata(schema: JsonSchemaObject): MetadataContract | undefined {
  const metadata = schema.$metadata;
  return typeof metadata === 'object' && metadata !== null ? (metadata as MetadataContract) : undefined;
}

function collectExternalRefIds(schema: unknown, refs: Set<string>): void {
  if (typeof schema !== 'object' || schema === null) return;
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
      refs.add(value.split('#', 1)[0] ?? value);
      continue;
    }
    collectExternalRefIds(value, refs);
  }
}

function findMetadataInReferencedSchemas(
  rootSchema: JsonSchemaObject,
  registry: Map<string, JsonSchemaObject>,
): MetadataContract | undefined {
  const visitedSchemaIds = new Set<string>();

  const walk = (schema: JsonSchemaObject): MetadataContract | undefined => {
    const refs = new Set<string>();
    collectExternalRefIds(schema, refs);

    for (const schemaId of refs) {
      if (visitedSchemaIds.has(schemaId)) continue;
      visitedSchemaIds.add(schemaId);

      const referencedSchema = registry.get(schemaId);
      if (!referencedSchema) continue;

      const metadata = readTopLevelMetadata(referencedSchema);
      if (metadata) return metadata;

      const nested = walk(referencedSchema);
      if (nested) return nested;
    }

    return undefined;
  };

  return walk(rootSchema);
}

export function loadMetadata(schemaPath: string): SchemaMetadata {
  const schema = readRawSchema(schemaPath);
  let metadata = readTopLevelMetadata(schema);

  // Metadata may live in a partial schema rather than the target.
  if (!metadata) {
    metadata = findMetadataInReferencedSchemas(schema, buildFullRegistry(schemaPath));
  }

  const rawHierarchy = metadata?.hierarchy?.levels;
  if (!rawHierarchy || rawHierarchy.length === 0) {
    throw new Error(`Schema at ${schemaPath} must define "$metadata.hierarchy.levels" for depth-based type inference`);
  }

  const levels: HierarchyLevel[] = rawHierarchy.map((entry) => {
    if (typeof entry === 'string') {
      return { type: entry, field: 'parent', fieldOn: 'child', multiple: false, selfRef: false };
    }
    return {
      type: entry.type,
      field: entry.field ?? 'parent',
      fieldOn: entry.fieldOn === 'parent' ? 'parent' : 'child',
      multiple: entry.multiple ?? false,
      selfRef: entry.selfRef ?? false,
    };
  });

  return {
    hierarchy: {
      levels,
      allowSkipLevels: metadata?.hierarchy?.allowSkipLevels,
    },
    typeAliases: (metadata?.aliases as Record<string, string>) ?? undefined,
    rules: (metadata?.rules as MetadataContractRules) ?? undefined,
  };
}
