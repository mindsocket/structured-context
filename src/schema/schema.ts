import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type AnySchemaObject, type ValidateFunction } from 'ajv';
import JSON5 from 'json5';
import type { Hierarchy, HierarchyLevel, SchemaMetadata, SchemaWithMetadata } from '../types';
import {
  DIALECT_META_SCHEMA,
  METADATA_SCHEMA,
  type MetadataContract,
  type MetadataContractHierarchy,
  type MetadataContractRelationship,
  type MetadataRef,
  type Rule,
  SCHEMA_META_ID,
} from './metadata-contract';
import { isObject, mergeVariantProperties, resolveJsonPointer } from './schema-refs';

const packageDir = import.meta.url ? dirname(fileURLToPath(import.meta.url)) : '';
export let bundledSchemasDir = packageDir ? join(packageDir, '..', '..', 'schemas') : '';

/** Override the bundled schemas directory (e.g. when running in a bundled context). */
export function setBundledSchemasDir(dir: string): void {
  bundledSchemasDir = dir;
}

const validateMetadataContract = new Ajv().compile(METADATA_SCHEMA);

/** File stem of each schema read from disk — the default name of the hierarchy it declares. */
const schemaFileStems = new WeakMap<AnySchemaObject, string>();

export function readRawSchema(schemaPath: string): AnySchemaObject {
  const schema = JSON5.parse(readFileSync(resolve(schemaPath), 'utf-8')) as AnySchemaObject;
  schemaFileStems.set(schema, basename(schemaPath, extname(schemaPath)));
  return schema;
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
 * - Layer 2: schema's own dir (partials + target file)
 * Throws if a layer 2 schema reuses an $id reserved by layer 1.
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

function readTopLevelMetadata(schema: AnySchemaObject): MetadataContract | undefined {
  const metadata = schema.$metadata;
  if (!isObject(metadata)) return undefined;
  const schemaId = typeof schema.$id === 'string' ? schema.$id : '(unknown schema)';
  if (isObject(metadata.hierarchy) && '$ref' in metadata.hierarchy && Object.keys(metadata.hierarchy).length > 1) {
    throw new Error(
      `Invalid $metadata in schema "${schemaId}": hierarchy both declares levels and selects a hierarchy with "$ref". Use one or the other.`,
    );
  }
  if (!validateMetadataContract(metadata)) {
    const errors =
      validateMetadataContract.errors?.map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ') ??
      'unknown error';
    throw new Error(`Invalid $metadata in schema "${schemaId}": ${errors}`);
  }
  return metadata as MetadataContract;
}

function resolveMetadataRef(
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

/**
 * Collect metadata providers in merge order: each schema's `$metadata.imports` depth-first, in
 * order, then the schema's own metadata. Each schema contributes at most once. `$ref` does not
 * import metadata.
 */
function collectMetadataProviders(
  rootSchema: AnySchemaObject,
  schemaRefRegistry: Map<string, AnySchemaObject>,
): MetadataProvider[] {
  const providers: MetadataProvider[] = [];
  const rootSchemaId = typeof rootSchema.$id === 'string' ? rootSchema.$id : '(root schema)';
  const visitedSchemaIds = new Set<string>([rootSchemaId]);

  const walk = (schema: AnySchemaObject, schemaId: string): void => {
    const metadata = readTopLevelMetadata(schema);
    if (!metadata) return;
    for (const importId of metadata.imports ?? []) {
      if (visitedSchemaIds.has(importId)) continue;
      visitedSchemaIds.add(importId);
      const importedSchema = schemaRefRegistry.get(importId);
      if (!importedSchema) {
        throw new Error(`Cannot resolve import "${importId}" in schema "${schemaId}".`);
      }
      walk(importedSchema, importId);
    }
    providers.push({ schemaId, schema, metadata });
  };

  walk(rootSchema, rootSchemaId);
  return providers;
}

function isRefEntry(value: unknown): value is MetadataRef {
  if (!isObject(value)) return false;
  return typeof value.$ref === 'string' && value.$ref.length > 0 && Object.keys(value).length === 1;
}

type Merged<T> = Map<string, { providerId: string; value: T }>;

/**
 * The single metadata merge rule: a duplicate key is an error unless the later entry sets
 * `override: true`, in which case it replaces the earlier one (keeping its position).
 */
function mergeEntry<T>(
  merged: Merged<T>,
  key: string,
  label: string,
  value: T,
  override: boolean | undefined,
  providerId: string,
): void {
  const existing = merged.get(key);
  if (existing && override !== true) {
    throw new Error(
      `Duplicate ${label} found in "${existing.providerId}" and "${providerId}". Set "override": true on the later one to replace it.`,
    );
  }
  merged.set(key, { providerId, value });
}

function values<T>(merged: Merged<T>): T[] {
  return [...merged.values()].map(({ value }) => value);
}

function extractMetadata(schema: AnySchemaObject, schemaRefRegistry: Map<string, AnySchemaObject>): SchemaMetadata {
  const metadataProviders = collectMetadataProviders(schema, schemaRefRegistry);

  // Hierarchies are merged by name; the declaring object is kept so a root `hierarchy: { $ref }`
  // selection can be matched to it.
  const mergedHierarchies: Merged<{ declared: MetadataContractHierarchy; hierarchy: Hierarchy }> = new Map();
  let rootHierarchy: MetadataContractHierarchy | undefined;
  let mainSelection: MetadataRef | undefined;
  const mergedAliases: Merged<string> = new Map();
  const mergedRules: Merged<Rule> = new Map();
  const mergedRelationships: Merged<MetadataContractRelationship> = new Map();

  for (const provider of metadataProviders) {
    const { schemaId, metadata } = provider;
    const declaredHierarchy = metadata.hierarchy;
    const isRoot = provider.schema === schema;
    if (isRefEntry(declaredHierarchy)) {
      // A hierarchy selection only applies when its schema is the root; imported schemas contribute
      // their declared hierarchies, not their selections.
      if (isRoot) mainSelection = declaredHierarchy;
    } else if (declaredHierarchy) {
      const hierarchy = normalizeHierarchy(declaredHierarchy, provider);
      const label = `hierarchy "${hierarchy.name}"`;
      mergeEntry(
        mergedHierarchies,
        hierarchy.name,
        label,
        { declared: declaredHierarchy, hierarchy },
        declaredHierarchy.override,
        schemaId,
      );
      if (isRoot) rootHierarchy = declaredHierarchy;
    }

    for (const [alias, target] of Object.entries(metadata.aliases ?? {})) {
      const [type, override] = typeof target === 'string' ? [target, false] : [target.type, target.override];
      mergeEntry(mergedAliases, alias, `alias "${alias}"`, type, override, schemaId);
    }

    for (const rel of metadata.relationships ?? []) {
      const field = rel.field ?? 'parent';
      const label = `relationship "${rel.parent} → ${rel.type}" (field "${field}")`;
      mergeEntry(mergedRelationships, `${rel.parent}\0${rel.type}\0${field}`, label, rel, rel.override, schemaId);
    }

    for (const rule of metadata.rules ?? []) {
      mergeEntry(mergedRules, rule.id, `rule "${rule.id}"`, rule, rule.override, schemaId);
    }
  }

  const merged = values(mergedHierarchies);
  const allHierarchies = merged.map(({ hierarchy }) => hierarchy);
  validateHierarchyTypes(allHierarchies);
  const findDeclared = (declared: unknown) => merged.find((entry) => entry.declared === declared)?.hierarchy;

  let mainHierarchy = rootHierarchy ? findDeclared(rootHierarchy) : undefined;
  if (mainSelection) {
    const target = resolveMetadataRef(mainSelection.$ref, schema, schemaRefRegistry);
    mainHierarchy = findDeclared(target.value);
    if (!mainHierarchy) {
      throw new Error(
        `Hierarchy $ref "${mainSelection.$ref}" does not point to a hierarchy declared by an imported schema. Expected a ref like "<schema $id>#/$metadata/hierarchy".`,
      );
    }
  } else if (!mainHierarchy && allHierarchies.length === 1) {
    mainHierarchy = allHierarchies[0];
  } else if (!mainHierarchy && allHierarchies.length > 1) {
    const rootSchemaId = typeof schema.$id === 'string' ? schema.$id : '(root schema)';
    throw new Error(
      `Schema "${rootSchemaId}" imports multiple hierarchies (${allHierarchies.map((h) => `"${h.name}"`).join(', ')}) but selects none as its main hierarchy. Declare one, or select one with "hierarchy": { "$ref": "<schema $id>#/$metadata/hierarchy" }.`,
    );
  }

  const typeAliases = Object.fromEntries([...mergedAliases].map(([alias, { value }]) => [alias, value]));
  const rules = values(mergedRules).map(({ override, ...rule }) => rule);
  const relationships = values(mergedRelationships);

  // Collect valid type names from the schema's oneOf list for validation
  const validTypeNames = extractSchemaTypeNames(schema as SchemaWithMetadata, schemaRefRegistry);

  // Validate metadata references against valid type names
  validateMetadataReferences({ allHierarchies, typeAliases, rules }, validTypeNames);

  // Filter relationships to only include those where both parent and child types are valid
  const filteredRelationships = relationships.filter((rel) => {
    return validTypeNames.has(rel.parent) && validTypeNames.has(rel.type);
  });

  return {
    hierarchy: mainHierarchy,
    hierarchies: allHierarchies.length > 0 ? allHierarchies : undefined,
    typeAliases: Object.keys(typeAliases).length > 0 ? typeAliases : undefined,
    rules: rules.length > 0 ? rules : undefined,
    relationships:
      filteredRelationships.length > 0
        ? filteredRelationships.map(({ override, ...rel }) => ({
            ...rel,
            field: rel.field ?? 'parent',
            fieldOn: rel.fieldOn === 'parent' ? 'parent' : ('child' as const),
            multiple: rel.multiple ?? false,
          }))
        : undefined,
  };
}

function normalizeHierarchy(declared: MetadataContractHierarchy, provider: MetadataProvider): Hierarchy {
  const levels: HierarchyLevel[] = declared.levels.map((entry) => {
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
    name: declared.name ?? schemaFileStems.get(provider.schema) ?? provider.schemaId,
    levels,
    allowSkipLevels: declared.allowSkipLevels,
  };
}

/** Each type may belong to at most one hierarchy. */
function validateHierarchyTypes(hierarchies: Hierarchy[]): void {
  const typeOwners = new Map<string, string>();
  for (const hierarchy of hierarchies) {
    for (const { type } of hierarchy.levels) {
      const owner = typeOwners.get(type);
      if (owner !== undefined && owner !== hierarchy.name) {
        throw new Error(
          `Type "${type}" belongs to both hierarchy "${owner}" and hierarchy "${hierarchy.name}". Each type may belong to at most one hierarchy.`,
        );
      }
      typeOwners.set(type, hierarchy.name);
    }
  }
}

interface MetadataForValidation {
  allHierarchies: Hierarchy[];
  typeAliases: Record<string, string>;
  rules: Rule[];
}

function validateMetadataReferences(metadata: MetadataForValidation, validTypes: Set<string>): void {
  // Skip validation if no types are defined (e.g., schemas without oneOf or placeholder schemas)
  if (validTypes.size === 0) {
    return;
  }

  const errors: string[] = [];

  // Validate hierarchy level types
  for (const hierarchy of metadata.allHierarchies) {
    for (const { type } of hierarchy.levels) {
      if (!validTypes.has(type)) {
        errors.push(`Hierarchy "${hierarchy.name}" level "${type}" is not a valid type in the schema's oneOf list`);
      }
    }
  }

  // Validate alias targets (the values)
  for (const [alias, target] of Object.entries(metadata.typeAliases)) {
    if (!validTypes.has(target)) {
      errors.push(`Alias "${alias}" → "${target}" references type "${target}" which is not in the schema's oneOf list`);
    }
  }

  // Note: relationships are filtered (not validated) - see extractMetadata

  // Validate rule types
  for (const rule of metadata.rules) {
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
