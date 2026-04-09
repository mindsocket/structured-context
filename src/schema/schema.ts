import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import Ajv, { type AnySchemaObject, type ValidateFunction } from 'ajv';
import { JSON5 } from 'bun';
import type { HierarchyLevel, RuleCategory, SchemaMetadata, SchemaWithMetadata } from '../types';
import {
  DIALECT_META_SCHEMA,
  METADATA_SCHEMA,
  type MetadataContract,
  type MetadataContractRelationship,
  type Rule,
  type RuleEntry,
  SCHEMA_META_ID,
} from './metadata-contract';
import { isObject, mergeVariantProperties, resolveJsonPointer } from './schema-refs';

const packageDir = dirname(fileURLToPath(import.meta.url));
export const bundledSchemasDir = join(packageDir, '..', '..', 'schemas');

const validateMetadataContract = new Ajv().compile(METADATA_SCHEMA);

export function readRawSchema(schemaPath: string): AnySchemaObject {
  return JSON5.parse(readFileSync(resolve(schemaPath), 'utf-8')) as AnySchemaObject;
}

/**
 * Build a registry of all schemas in the given directory, keyed by $id.
 * Only loads "partial" schemas (starting with _) and an optional target file.
 */
function buildSchemaRegistry(dir: string, targetFile?: string): Map<string, AnySchemaObject> {
  const schemaRefRegistry = new Map<string, AnySchemaObject>();
  if (!existsSync(dir)) return schemaRefRegistry;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const isPartial = file.startsWith('_');
    const isTarget = targetFile !== undefined && file === targetFile;
    if (!isPartial && !isTarget) continue;

    const schema = readRawSchema(join(dir, file));
    if (typeof schema.$id === 'string') schemaRefRegistry.set(schema.$id, schema);
  }
  return schemaRefRegistry;
}

/**
 * Build the full two-layer registry for a schema path:
 * - Layer 1: bundled schemas/ dir (partials only, as fallback)
 * - Layer 2: schema's own dir (partials + target file) — overrides layer 1
 * Does not throw on $id collision; layer 2 silently wins.
 */
export function buildFullRegistry(schemaPath: string): Map<string, AnySchemaObject> {
  const absPath = resolve(schemaPath);
  const targetFile = basename(absPath);
  const targetDir = dirname(absPath);

  const schemaRefRegistry = new Map<string, AnySchemaObject>();

  // Layer 1: bundled schemas/ dir (partials only)
  for (const [id, schema] of buildSchemaRegistry(bundledSchemasDir)) {
    schemaRefRegistry.set(id, schema);
  }

  // Layer 2: schema's own dir (partials + target file)
  if (targetDir !== bundledSchemasDir) {
    const bundledIds = new Set(schemaRefRegistry.keys());
    bundledIds.add(SCHEMA_META_ID);
    for (const [id, schema] of buildSchemaRegistry(targetDir, targetFile)) {
      if (bundledIds.has(id)) {
        throw new Error(
          `Schema collision: partial schema in ${targetDir} uses $id "${id}" which is reserved by a default schema. Please use a unique $id for local partials.`,
        );
      }
      schemaRefRegistry.set(id, schema);
    }
  }

  return schemaRefRegistry;
}

function compileValidator(
  targetSchema: AnySchemaObject,
  schemaRefRegistry: Map<string, AnySchemaObject>,
): ValidateFunction {
  const ajv = new Ajv();
  ajv.addFormat('path', (value: string) => value.length > 0 && !value.includes('\0'));
  ajv.addFormat('date', (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  ajv.addFormat('wikilink', (value: string) => /^\[\[.+\]\]$/.test(value));
  ajv.addKeyword({
    keyword: '$metadata',
    schemaType: 'object',
    metaSchema: METADATA_SCHEMA as unknown as AnySchemaObject,
    valid: true,
    errors: false,
  });
  const metaSchema = DIALECT_META_SCHEMA as unknown as AnySchemaObject;
  ajv.addSchema(metaSchema, SCHEMA_META_ID);

  // Register all except target schema (AJV compiles targetSchema explicitly)
  for (const [id, schema] of schemaRefRegistry) {
    if (id === targetSchema.$id || id === SCHEMA_META_ID) continue;
    ajv.addSchema(schema);
  }

  return ajv.compile(targetSchema);
}

export function createValidator(schemaPath: string): ValidateFunction {
  return compileValidator(readRawSchema(schemaPath), buildFullRegistry(schemaPath));
}

export function resolveNodeType(type: string, typeAliases: Record<string, string> | undefined): string {
  return typeAliases?.[type] ?? type;
}

interface MetadataProvider {
  schemaId: string;
  schema: AnySchemaObject;
  metadata: MetadataContract;
}

const RULE_CATEGORIES = new Set<RuleCategory>(['validation', 'coherence', 'workflow', 'best-practice']);
const RULE_ALLOWED_KEYS = new Set(['id', 'category', 'description', 'check', 'type', 'scope', 'override']);

function readTopLevelMetadata(schema: AnySchemaObject): MetadataContract | undefined {
  const metadata = schema.$metadata;
  if (!isObject(metadata)) return undefined;
  if (!validateMetadataContract(metadata)) {
    const schemaId = typeof schema.$id === 'string' ? schema.$id : '(unknown schema)';
    const errors =
      validateMetadataContract.errors?.map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ') ??
      'unknown error';
    throw new Error(`Invalid $metadata in schema "${schemaId}": ${errors}`);
  }
  return metadata as MetadataContract;
}

function resolveRefTargetForRule(
  ref: string,
  currentRootSchema: AnySchemaObject,
  schemaRefRegistry: Map<string, AnySchemaObject>,
): { value: unknown; rootSchema: AnySchemaObject; refKey: string } {
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
  const externalSchema = schemaRefRegistry.get(baseId);
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
  rootSchema: AnySchemaObject,
  schemaRefRegistry: Map<string, AnySchemaObject>,
): MetadataProvider[] {
  const providers: MetadataProvider[] = [];
  const visitedSchemaIds = new Set<string>();

  const walk = (schema: AnySchemaObject): void => {
    const refs = collectExternalRefIdsInOrder(schema);
    for (const schemaId of refs) {
      if (visitedSchemaIds.has(schemaId)) continue;
      visitedSchemaIds.add(schemaId);

      const referencedSchema = schemaRefRegistry.get(schemaId);
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

function isMetadataRule(value: unknown): value is Rule {
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
  ruleEntry: RuleEntry,
  provider: MetadataProvider,
  schemaRefRegistry: Map<string, AnySchemaObject>,
  stack: Set<string>,
): Rule[] {
  if (isMetadataRule(ruleEntry)) {
    return [ruleEntry];
  }

  if (!isRuleRefEntry(ruleEntry)) {
    throw new Error(`Invalid rule entry in metadata from "${provider.schemaId}".`);
  }

  const target = resolveRefTargetForRule(ruleEntry.$ref, provider.schema, schemaRefRegistry);
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

    const resolveArray = (arr: unknown[]): Rule[] => {
      const resolvedRules: Rule[] = [];
      for (const child of arr) {
        if (!isObject(child)) {
          throw new Error(
            `Invalid rule import target for "${ruleEntry.$ref}" from "${provider.schemaId}". Rule sets must contain objects.`,
          );
        }
        resolvedRules.push(
          ...resolveRuleEntries(
            child as RuleEntry,
            { ...provider, schema: target.rootSchema },
            schemaRefRegistry,
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
        value as RuleEntry,
        { ...provider, schema: target.rootSchema },
        schemaRefRegistry,
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

function normalizeRule(rule: Rule): Rule {
  const { override, ...normalized } = rule;
  return normalized;
}

function areRulesEquivalent(left: Rule, right: Rule): boolean {
  return isDeepStrictEqual(normalizeRule(left), normalizeRule(right));
}

function extractMetadata(schema: AnySchemaObject, schemaRefRegistry: Map<string, AnySchemaObject>): SchemaMetadata {
  const metadataProviders = collectMetadataProviders(schema, schemaRefRegistry);

  let mergedHierarchy: MetadataContract['hierarchy'] | undefined;
  const mergedAliases: Record<string, string> = {};
  const mergedRules = new Map<string, { providerId: string; rule: Rule }>();
  const mergedRelationships: MetadataContractRelationship[] = [];

  for (const provider of metadataProviders) {
    if (provider.metadata.hierarchy) {
      // Later providers (including root schema) override earlier ones (e.g. partials).
      // This allows partials to define a default hierarchy that composing schemas can override.
      mergedHierarchy = provider.metadata.hierarchy;
    }

    if (provider.metadata.aliases) {
      Object.assign(mergedAliases, provider.metadata.aliases);
    }

    if (provider.metadata.relationships) {
      mergedRelationships.push(...provider.metadata.relationships);
    }

    if (provider.metadata.rules) {
      for (const entry of provider.metadata.rules) {
        const resolvedRules = resolveRuleEntries(entry, provider, schemaRefRegistry, new Set());
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

  // Collect valid type names from the schema's oneOf list for validation
  const validTypeNames = extractSchemaTypeNames(schema as SchemaWithMetadata, schemaRefRegistry);

  // Validate and filter metadata references against valid type names
  validateMetadataReferences({ mergedHierarchy, mergedAliases, mergedRules, mergedRelationships }, validTypeNames);

  // Filter relationships to only include those where both parent and child types are valid
  const filteredRelationships = mergedRelationships.filter((rel) => {
    return validTypeNames.has(rel.parent) && validTypeNames.has(rel.type);
  });

  const levels: HierarchyLevel[] | undefined = mergedHierarchy?.levels.map((entry) => {
    if (typeof entry === 'string') {
      return { type: entry, field: 'parent', fieldOn: 'child', multiple: false, selfRef: false };
    }
    // If selfRefField is set, imply selfRef: true
    const selfRef = entry.selfRefField !== undefined ? true : (entry.selfRef ?? false);
    return {
      type: entry.type,
      field: entry.field ?? 'parent',
      fieldOn: entry.fieldOn === 'parent' ? 'parent' : 'child',
      multiple: entry.multiple ?? false,
      selfRef,
      selfRefField: entry.selfRefField,
      templateFormat: entry.templateFormat,
      matchers: entry.matchers,
      embeddedTemplateFields: entry.embeddedTemplateFields,
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
    relationships:
      filteredRelationships.length > 0
        ? filteredRelationships.map((rel) => ({
            ...rel,
            field: rel.field ?? 'parent',
            fieldOn: rel.fieldOn === 'parent' ? 'parent' : ('child' as const),
            multiple: rel.multiple ?? false,
          }))
        : undefined,
  };
}

interface MetadataForValidation {
  mergedHierarchy: MetadataContract['hierarchy'] | undefined;
  mergedAliases: Record<string, string>;
  mergedRules: Map<string, { providerId: string; rule: Rule }>;
  mergedRelationships: MetadataContractRelationship[];
}

function validateMetadataReferences(metadata: MetadataForValidation, validTypes: Set<string>): void {
  // Skip validation if no types are defined (e.g., schemas without oneOf or placeholder schemas)
  if (validTypes.size === 0) {
    return;
  }

  const errors: string[] = [];

  // Validate hierarchy level types
  if (metadata.mergedHierarchy?.levels) {
    for (const level of metadata.mergedHierarchy.levels) {
      const typeName = typeof level === 'string' ? level : level.type;
      if (!validTypes.has(typeName)) {
        errors.push(`Hierarchy level "${typeName}" is not a valid type in the schema's oneOf list`);
      }
    }
  }

  // Validate alias targets (the values)
  for (const [alias, target] of Object.entries(metadata.mergedAliases)) {
    if (!validTypes.has(target)) {
      errors.push(`Alias "${alias}" → "${target}" references type "${target}" which is not in the schema's oneOf list`);
    }
  }

  // Note: relationships are filtered (not validated) - see extractMetadata

  // Validate rule types
  for (const { rule } of metadata.mergedRules.values()) {
    if (rule.type && !validTypes.has(rule.type)) {
      errors.push(`Rule "${rule.id}" has type "${rule.type}" which is not in the schema's oneOf list`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Schema metadata validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

export interface EntityInfo {
  type: string;
  properties: string[];
  required: string[];
}

export function extractEntityInfo(
  schema: SchemaWithMetadata,
  schemaRefRegistry: Map<string, AnySchemaObject>,
): EntityInfo[] {
  if (!Array.isArray(schema.oneOf)) return [];
  const result: EntityInfo[] = [];
  for (const entry of schema.oneOf as AnySchemaObject[]) {
    const { properties, required } = mergeVariantProperties(entry, schema, schemaRefRegistry);
    const typeDef = properties.type as AnySchemaObject | undefined;
    if (typeDef?.const !== undefined) {
      result.push({
        type: String(typeDef.const),
        properties: Object.keys(properties).filter((k) => k !== 'type'),
        required: required.filter((r) => r !== 'type'),
      });
    } else if (Array.isArray(typeDef?.enum)) {
      for (const t of typeDef.enum as unknown[]) {
        result.push({
          type: String(t),
          properties: Object.keys(properties).filter((k) => k !== 'type'),
          required: required.filter((r) => r !== 'type'),
        });
      }
    }
  }
  return result;
}

export function extractSchemaTypeNames(
  schema: SchemaWithMetadata,
  schemaRefRegistry: Map<string, AnySchemaObject>,
): Set<string> {
  return new Set(extractEntityInfo(schema, schemaRefRegistry).map((e) => e.type));
}

export function loadMetadata(schemaPath: string): SchemaMetadata {
  return extractMetadata(readRawSchema(schemaPath), buildFullRegistry(schemaPath));
}

export interface LoadedSchema {
  schema: SchemaWithMetadata;
  schemaRefRegistry: Map<string, AnySchemaObject>;
  schemaValidator: ValidateFunction;
}

export function loadSchema(schemaPath: string): LoadedSchema {
  const rawSchema = readRawSchema(schemaPath);
  const schemaRefRegistry = buildFullRegistry(schemaPath);
  const schema = {
    ...rawSchema,
    metadata: extractMetadata(rawSchema, schemaRefRegistry),
  } as unknown as SchemaWithMetadata;
  return {
    schema,
    schemaRefRegistry,
    schemaValidator: compileValidator(rawSchema, schemaRefRegistry),
  };
}
