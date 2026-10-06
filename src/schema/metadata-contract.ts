import type { FromSchema } from 'json-schema-to-ts';

/** The JSON Schema dialect the structured-context dialect extends. */
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export const SCHEMA_META_BASE_URL =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated';
export const SCHEMA_META_FILE = '_structured_context_schema_meta.json';

/** Meta-schema `$id` for a dialect version folder, e.g. `.../generated/0.12.0/_structured_context_schema_meta.json`. */
export function schemaMetaId(folder: string): string {
  return `${SCHEMA_META_BASE_URL}/${folder}/${SCHEMA_META_FILE}`;
}

/** The URL schemas set as `$schema` to follow the newest dialect. Resolves to the newest versioned meta-schema. */
export const SCHEMA_META_ID = schemaMetaId('latest');

/** Graph edge routing fields shared by hierarchy levels and relationships. */
const EDGE_PROPS = {
  field: { type: 'string', minLength: 1 },
  fieldOn: { enum: ['child', 'parent'] },
  multiple: { type: 'boolean' },
} as const;

/** Embedding/template hint fields shared by hierarchy levels and relationships. */
const EMBEDDING_PROPS = {
  templateFormat: { enum: ['heading', 'list', 'table', 'page'] },
  matchers: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
  embeddedTemplateFields: { type: 'array', items: { type: 'string', minLength: 1 } },
} as const;

/** Schema objects wrapping each prop group for type derivation via FromSchema. */
const EDGE_SCHEMA = {
  type: 'object',
  properties: EDGE_PROPS,
  additionalProperties: false,
} as const;

const EMBEDDING_SCHEMA = {
  type: 'object',
  properties: EMBEDDING_PROPS,
  additionalProperties: false,
} as const;

const HIERARCHY_LEVEL_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', minLength: 1 },
    ...EDGE_PROPS,
    ...EMBEDDING_PROPS,
    selfRef: { type: 'boolean' },
    selfRefField: { type: 'string', minLength: 1 },
  },
  required: ['type'],
  additionalProperties: false,
} as const;

const RULE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    category: { enum: ['validation', 'coherence', 'workflow', 'best-practice'] },
    severity: { enum: ['error', 'warning', 'info'] },
    description: { type: 'string', minLength: 1 },
    check: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    scope: { enum: ['global'] },
    override: { type: 'boolean' },
  },
  required: ['id', 'category', 'description', 'check'],
  additionalProperties: false,
} as const;

const REF_SCHEMA = {
  type: 'object',
  properties: {
    $ref: { type: 'string', minLength: 1 },
  },
  required: ['$ref'],
  additionalProperties: false,
} as const;

const HIERARCHY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    override: { type: 'boolean' },
    levels: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [{ type: 'string', minLength: 1 }, HIERARCHY_LEVEL_SCHEMA],
      },
    },
    allowSkipLevels: { type: 'boolean' },
  },
  required: ['levels'],
  additionalProperties: false,
} as const;

const RELATIONSHIP_SCHEMA = {
  type: 'object',
  properties: {
    parent: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    ...EDGE_PROPS,
    ...EMBEDDING_PROPS,
    override: { type: 'boolean' },
  },
  required: ['parent', 'type'],
  additionalProperties: false,
} as const;

/** An alias target: a type name, or `{ type, override: true }` to replace an imported alias. */
const ALIAS_SCHEMA = {
  oneOf: [
    { type: 'string', minLength: 1 },
    {
      type: 'object',
      properties: {
        type: { type: 'string', minLength: 1 },
        override: { type: 'boolean' },
      },
      required: ['type'],
      additionalProperties: false,
    },
  ],
} as const;

export const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    // $ids of schemas whose metadata (and their imports' metadata) is merged into this schema's.
    imports: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    // Either declares this schema's hierarchy, or (root schema only) selects an imported one via $ref.
    hierarchy: {
      oneOf: [HIERARCHY_SCHEMA, REF_SCHEMA],
    },
    relationships: {
      type: 'array',
      items: RELATIONSHIP_SCHEMA,
    },
    aliases: {
      type: 'object',
      additionalProperties: ALIAS_SCHEMA,
    },
    rules: {
      type: 'array',
      items: RULE_SCHEMA,
    },
  },
  additionalProperties: false,
} as const;

/** The dialect meta-schema, published under `$id`. */
export function buildDialectMetaSchema(id: string) {
  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: id,
    title: 'structured-context schema dialect',
    description:
      'Extends JSON Schema 2020-12 with top-level $metadata for imports, hierarchy, relationships, aliases and rules.',
    type: 'object',
    allOf: [{ $ref: JSON_SCHEMA_DIALECT }],
    properties: {
      $metadata: METADATA_SCHEMA,
    },
  } as const;
}

export type MetadataContract = FromSchema<typeof METADATA_SCHEMA>;
export type MetadataContractHierarchy = FromSchema<typeof HIERARCHY_SCHEMA>;
export type MetadataContractHierarchyLevel = FromSchema<typeof HIERARCHY_LEVEL_SCHEMA>;
export type MetadataContractRelationship = FromSchema<typeof RELATIONSHIP_SCHEMA>;
export type SharedEdgeFields = FromSchema<typeof EDGE_SCHEMA>;
export type SharedEmbeddingFields = FromSchema<typeof EMBEDDING_SCHEMA>;
export type Rule = FromSchema<typeof RULE_SCHEMA>;
export type MetadataRef = FromSchema<typeof REF_SCHEMA>;
