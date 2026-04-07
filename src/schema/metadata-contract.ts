import type { FromSchema } from 'json-schema-to-ts';

export const SCHEMA_META_ID =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/_structured_context_schema_meta.json';

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
    description: { type: 'string', minLength: 1 },
    check: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    scope: { enum: ['global'] },
    override: { type: 'boolean' },
  },
  required: ['id', 'category', 'description', 'check'],
  additionalProperties: false,
} as const;

const RULE_REF_SCHEMA = {
  type: 'object',
  properties: {
    $ref: { type: 'string', minLength: 1 },
  },
  required: ['$ref'],
  additionalProperties: false,
} as const;

const RELATIONSHIP_SCHEMA = {
  type: 'object',
  properties: {
    parent: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    ...EDGE_PROPS,
    ...EMBEDDING_PROPS,
  },
  required: ['parent', 'type'],
  additionalProperties: false,
} as const;

export const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    hierarchy: {
      type: 'object',
      properties: {
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
    },
    relationships: {
      type: 'array',
      items: RELATIONSHIP_SCHEMA,
    },
    aliases: {
      type: 'object',
      additionalProperties: { type: 'string', minLength: 1 },
    },
    rules: {
      type: 'array',
      items: {
        oneOf: [RULE_SCHEMA, RULE_REF_SCHEMA],
      },
    },
  },
  additionalProperties: false,
} as const;

export const DIALECT_META_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: SCHEMA_META_ID,
  title: 'structured-context schema dialect',
  description: 'Extends JSON Schema Draft-07 with top-level $metadata for hierarchy and rule metadata.',
  type: 'object',
  allOf: [{ $ref: 'http://json-schema.org/draft-07/schema#' }],
  properties: {
    $metadata: METADATA_SCHEMA,
  },
} as const;

export type MetadataContract = FromSchema<typeof METADATA_SCHEMA>;
export type MetadataContractHierarchyLevel = FromSchema<typeof HIERARCHY_LEVEL_SCHEMA>;
export type MetadataContractRelationship = FromSchema<typeof RELATIONSHIP_SCHEMA>;
export type SharedEdgeFields = FromSchema<typeof EDGE_SCHEMA>;
export type SharedEmbeddingFields = FromSchema<typeof EMBEDDING_SCHEMA>;
export type Rule = FromSchema<typeof RULE_SCHEMA>;
export type RuleRef = FromSchema<typeof RULE_REF_SCHEMA>;
export type RuleEntry = Rule | RuleRef;
