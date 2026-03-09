import type { FromSchema } from 'json-schema-to-ts';

export const OST_TOOLS_SCHEMA_META_ID =
  'https://raw.githubusercontent.com/mindsocket/ost-tools/main/schemas/generated/_ost_tools_schema_meta.json';

const HIERARCHY_LEVEL_SCHEMA = {
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
  },
  required: ['id', 'category', 'description', 'check'],
  additionalProperties: false,
} as const;

export const OST_TOOLS_METADATA_SCHEMA = {
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
    aliases: {
      type: 'object',
      additionalProperties: { type: 'string', minLength: 1 },
    },
    rules: {
      type: 'array',
      items: RULE_SCHEMA,
    },
  },
  required: ['hierarchy'],
  additionalProperties: false,
} as const;

export const OST_TOOLS_DIALECT_META_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: OST_TOOLS_SCHEMA_META_ID,
  title: 'ost-tools schema dialect',
  description: 'Extends JSON Schema Draft-07 with top-level $metadata for hierarchy and rule metadata.',
  type: 'object',
  allOf: [{ $ref: 'http://json-schema.org/draft-07/schema#' }],
  properties: {
    $metadata: OST_TOOLS_METADATA_SCHEMA,
  },
} as const;

export type MetadataContract = FromSchema<typeof OST_TOOLS_METADATA_SCHEMA>;
export type MetadataContractHierarchy = MetadataContract['hierarchy'];
export type MetadataContractRules = Exclude<MetadataContract['rules'], undefined>;
export type MetadataContractRule = MetadataContractRules[number];
