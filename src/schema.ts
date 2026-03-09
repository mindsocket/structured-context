import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import JSON5 from 'json5';
import type { HierarchyLevel, RulesMetadata, SchemaMetadata } from './types';

const packageDir = dirname(fileURLToPath(import.meta.url));
export const bundledSchemasDir = join(packageDir, '..', 'schemas');
export const OST_TOOLS_SCHEMA_META_ID = 'ost-tools://_ost_tools_schema_meta';
/** Parsed JSON schema object — always a plain object (never a boolean schema). */
type JsonSchemaObject = Record<string, unknown>;
const METADATA_KEYWORD_SCHEMA: JsonSchemaObject = {
  type: 'object',
  properties: {
    hierarchy: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [
          { type: 'string', minLength: 1 },
          {
            type: 'object',
            properties: {
              type: { type: 'string', minLength: 1 },
              field: { type: 'string', minLength: 1 },
              fieldOn: { enum: ['child', 'parent'] },
              multiple: { type: 'boolean' },
              selfRef: { type: 'boolean' },
            },
            required: ['type'],
            additionalProperties: false,
          },
        ],
      },
    },
    aliases: {
      type: 'object',
      additionalProperties: { type: 'string', minLength: 1 },
    },
    allowSkipLevels: { type: 'boolean' },
    rules: {
      type: 'object',
      properties: {
        validation: { $ref: '#/$defs/rulesList' },
        coherence: { $ref: '#/$defs/rulesList' },
        workflow: { $ref: '#/$defs/rulesList' },
        bestPractice: { $ref: '#/$defs/rulesList' },
      },
      additionalProperties: false,
    },
  },
  required: ['hierarchy'],
  additionalProperties: false,
  $defs: {
    rulesList: {
      type: 'array',
      items: { $ref: '#/$defs/rule' },
    },
    rule: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        check: { type: 'string', minLength: 1 },
        type: { type: 'string', minLength: 1 },
        scope: { enum: ['global'] },
      },
      required: ['id', 'description', 'check'],
      additionalProperties: false,
    },
  },
};

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
  ajv.addKeyword({
    keyword: '$metadata',
    schemaType: 'object',
    metaSchema: METADATA_KEYWORD_SCHEMA,
    valid: true,
    errors: false,
  });

  const registry = buildFullRegistry(schemaPath);
  const dialectSchema = registry.get(OST_TOOLS_SCHEMA_META_ID);

  // Register dialect metaschema first so other schemas can reference it via "$schema".
  if (dialectSchema && targetSchema.$id !== OST_TOOLS_SCHEMA_META_ID) {
    ajv.addSchema(dialectSchema);
  }

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

function readTopLevelMetadata(schema: JsonSchemaObject): Record<string, unknown> | undefined {
  const metadata = schema.$metadata;
  return typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : undefined;
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
): Record<string, unknown> | undefined {
  const visitedSchemaIds = new Set<string>();

  const walk = (schema: JsonSchemaObject): Record<string, unknown> | undefined => {
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

  const rawHierarchy = metadata?.hierarchy as Array<string | Record<string, unknown>> | undefined;
  if (!rawHierarchy || rawHierarchy.length === 0) {
    throw new Error(`Schema at ${schemaPath} must define "$metadata.hierarchy" for depth-based type inference`);
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
    typeAliases: (metadata?.aliases as Record<string, string>) ?? undefined,
    allowSkipLevels: (metadata?.allowSkipLevels as boolean) ?? undefined,
    rules: (metadata?.rules as RulesMetadata) ?? undefined,
  };
}
