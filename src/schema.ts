import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import Ajv, { type ValidateFunction } from 'ajv';
import JSON5 from 'json5';
import {
  type MetadataContract,
  type MetadataContractRule,
  type MetadataContractRuleEntry,
  OST_TOOLS_DIALECT_META_SCHEMA,
  OST_TOOLS_METADATA_SCHEMA,
  OST_TOOLS_SCHEMA_META_ID,
} from './metadata-contract';
import { isObject, resolveJsonPointer } from './schema-refs';
import type { HierarchyLevel, RuleCategory, SchemaMetadata } from './types';

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

interface MetadataProvider {
  schemaId: string;
  schema: JsonSchemaObject;
  metadata: MetadataContract;
}

const RULE_CATEGORIES = new Set<RuleCategory>(['validation', 'coherence', 'workflow', 'best-practice']);
const RULE_ALLOWED_KEYS = new Set(['id', 'category', 'description', 'check', 'type', 'scope', 'override']);

function readTopLevelMetadata(schema: JsonSchemaObject): MetadataContract | undefined {
  const metadata = schema.$metadata;
  return isObject(metadata) ? (metadata as MetadataContract) : undefined;
}

function resolveRefTargetForRule(
  ref: string,
  currentRootSchema: JsonSchemaObject,
  registry: Map<string, JsonSchemaObject>,
): { value: unknown; rootSchema: JsonSchemaObject; refKey: string } {
  if (ref.startsWith('#')) {
    const pointer = ref.slice(1);
    const rootId = typeof currentRootSchema.$id === 'string' ? currentRootSchema.$id : '(root schema)';
    return {
      value: resolveJsonPointer(currentRootSchema, pointer, ref),
      rootSchema: currentRootSchema,
      refKey: `${rootId}#${pointer}`,
    };
  }

  const hashIndex = ref.indexOf('#');
  const baseId = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
  const pointer = hashIndex >= 0 ? ref.slice(hashIndex + 1) : '';
  const externalSchema = registry.get(baseId);
  if (!externalSchema) {
    throw new Error(`Cannot resolve external $ref: ${ref}`);
  }

  return {
    value: resolveJsonPointer(externalSchema, pointer, ref),
    rootSchema: externalSchema,
    refKey: `${baseId}#${pointer}`,
  };
}

function collectExternalRefIdsInOrder(schema: unknown): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  const walk = (value: unknown): void => {
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && !child.startsWith('#')) {
        const schemaId = child.split('#', 1)[0] ?? child;
        if (!seen.has(schemaId)) {
          seen.add(schemaId);
          refs.push(schemaId);
        }
        continue;
      }
      walk(child);
    }
  };

  walk(schema);
  return refs;
}

function collectMetadataProviders(
  rootSchema: JsonSchemaObject,
  registry: Map<string, JsonSchemaObject>,
): MetadataProvider[] {
  const providers: MetadataProvider[] = [];
  const visitedSchemaIds = new Set<string>();

  const walk = (schema: JsonSchemaObject): void => {
    const refs = collectExternalRefIdsInOrder(schema);
    for (const schemaId of refs) {
      if (visitedSchemaIds.has(schemaId)) continue;
      visitedSchemaIds.add(schemaId);

      const referencedSchema = registry.get(schemaId);
      if (!referencedSchema) continue;

      walk(referencedSchema);

      const metadata = readTopLevelMetadata(referencedSchema);
      if (metadata) {
        providers.push({ schemaId, schema: referencedSchema, metadata });
      }
    }
  };

  walk(rootSchema);

  const rootMetadata = readTopLevelMetadata(rootSchema);
  if (rootMetadata) {
    const rootSchemaId = typeof rootSchema.$id === 'string' ? rootSchema.$id : '(root schema)';
    providers.push({ schemaId: rootSchemaId, schema: rootSchema, metadata: rootMetadata });
  }

  return providers;
}

function isRuleRefEntry(value: unknown): value is { $ref: string } {
  if (!isObject(value)) return false;
  return typeof value.$ref === 'string' && value.$ref.length > 0 && Object.keys(value).length === 1;
}

function isMetadataRule(value: unknown): value is MetadataContractRule {
  if (!isObject(value)) return false;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.length === 0) return false;
  if (typeof record.category !== 'string' || !RULE_CATEGORIES.has(record.category as RuleCategory)) return false;
  if (typeof record.description !== 'string' || record.description.length === 0) return false;
  if (typeof record.check !== 'string' || record.check.length === 0) return false;

  if ('type' in record && (typeof record.type !== 'string' || record.type.length === 0)) return false;
  if ('scope' in record && record.scope !== 'global') return false;
  if ('override' in record && typeof record.override !== 'boolean') return false;

  for (const key of Object.keys(record)) {
    if (!RULE_ALLOWED_KEYS.has(key)) return false;
  }

  return true;
}

function resolveRuleEntries(
  ruleEntry: MetadataContractRuleEntry,
  provider: MetadataProvider,
  registry: Map<string, JsonSchemaObject>,
  stack: Set<string>,
): MetadataContractRule[] {
  if (isMetadataRule(ruleEntry)) {
    return [ruleEntry];
  }

  if (!isRuleRefEntry(ruleEntry)) {
    throw new Error(`Invalid rule entry in metadata from "${provider.schemaId}".`);
  }

  const target = resolveRefTargetForRule(ruleEntry.$ref, provider.schema, registry);
  if (stack.has(target.refKey)) {
    throw new Error(
      `Cyclic rule import detected while loading metadata from "${provider.schemaId}": ${[...stack, target.refKey].join(
        ' -> ',
      )}`,
    );
  }

  stack.add(target.refKey);
  try {
    const value = target.value;

    const resolveArray = (arr: unknown[]): MetadataContractRule[] => {
      const resolvedRules: MetadataContractRule[] = [];
      for (const child of arr) {
        if (!isObject(child)) {
          throw new Error(
            `Invalid rule import target for "${ruleEntry.$ref}" from "${provider.schemaId}". Rule sets must contain objects.`,
          );
        }
        resolvedRules.push(
          ...resolveRuleEntries(
            child as MetadataContractRuleEntry,
            { ...provider, schema: target.rootSchema },
            registry,
            stack,
          ),
        );
      }
      return resolvedRules;
    };

    if (Array.isArray(value)) {
      return resolveArray(value);
    }

    if (isObject(value) && 'rules' in value) {
      const nestedRules = value.rules;
      if (!Array.isArray(nestedRules)) {
        throw new Error(
          `Invalid rule import target for "${ruleEntry.$ref}" from "${provider.schemaId}". "rules" must be an array.`,
        );
      }
      return resolveArray(nestedRules);
    }

    if (isObject(value)) {
      return resolveRuleEntries(
        value as MetadataContractRuleEntry,
        { ...provider, schema: target.rootSchema },
        registry,
        stack,
      );
    }

    throw new Error(
      `Invalid rule import target for "${ruleEntry.$ref}" from "${provider.schemaId}". Expected a rule object or rule set.`,
    );
  } finally {
    stack.delete(target.refKey);
  }
}

function normalizeRule(rule: MetadataContractRule): MetadataContractRule {
  const { override, ...normalized } = rule;
  return normalized;
}

function areRulesEquivalent(left: MetadataContractRule, right: MetadataContractRule): boolean {
  return isDeepStrictEqual(normalizeRule(left), normalizeRule(right));
}

export function loadMetadata(schemaPath: string): SchemaMetadata {
  const schema = readRawSchema(schemaPath);
  const registry = buildFullRegistry(schemaPath);
  const metadataProviders = collectMetadataProviders(schema, registry);

  let hierarchyProvider: string | undefined;
  let mergedHierarchy: MetadataContract['hierarchy'] | undefined;
  const mergedAliases: Record<string, string> = {};
  const mergedRules = new Map<string, { providerId: string; rule: MetadataContractRule }>();

  for (const provider of metadataProviders) {
    if (provider.metadata.hierarchy) {
      if (mergedHierarchy) {
        throw new Error(
          `Multiple metadata providers define "$metadata.hierarchy": "${hierarchyProvider}" and "${provider.schemaId}". Exactly one provider is allowed.`,
        );
      }
      hierarchyProvider = provider.schemaId;
      mergedHierarchy = provider.metadata.hierarchy;
    }

    if (provider.metadata.aliases) {
      Object.assign(mergedAliases, provider.metadata.aliases);
    }

    if (provider.metadata.rules) {
      for (const entry of provider.metadata.rules) {
        const resolvedRules = resolveRuleEntries(entry, provider, registry, new Set());
        for (const incomingRule of resolvedRules) {
          const existingRule = mergedRules.get(incomingRule.id);
          if (!existingRule) {
            mergedRules.set(incomingRule.id, { providerId: provider.schemaId, rule: incomingRule });
            continue;
          }

          if (incomingRule.override === true) {
            mergedRules.set(incomingRule.id, { providerId: provider.schemaId, rule: incomingRule });
            continue;
          }

          if (!areRulesEquivalent(existingRule.rule, incomingRule)) {
            throw new Error(
              `Conflicting rule "${incomingRule.id}" found in "${existingRule.providerId}" and "${provider.schemaId}". Set "override": true on the later rule to replace it.`,
            );
          }
        }
      }
    }
  }

  const levels: HierarchyLevel[] | undefined = mergedHierarchy?.levels.map((entry) => {
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
    hierarchy:
      levels !== undefined
        ? {
            levels,
            allowSkipLevels: mergedHierarchy?.allowSkipLevels,
          }
        : undefined,
    typeAliases: Object.keys(mergedAliases).length > 0 ? mergedAliases : undefined,
    rules: mergedRules.size > 0 ? [...mergedRules.values()].map(({ rule }) => normalizeRule(rule)) : undefined,
  };
}
