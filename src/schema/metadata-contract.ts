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

const SEVERITY_SCHEMA = { enum: ['error', 'warning', 'info'] } as const;

const RULE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    category: { enum: ['validation', 'coherence', 'workflow', 'best-practice'] },
    /**
     * A severity, or (semantic rules only) a map of verdict to severity. In a map, a verdict mapped to
     * `ignore` is judged but not reported, and a verdict left out passes. Defaults from the category.
     */
    severity: {
      oneOf: [
        SEVERITY_SCHEMA,
        {
          type: 'object',
          additionalProperties: { enum: ['error', 'warning', 'info', 'ignore'] },
          minProperties: 1,
        },
      ],
    },
    description: { type: 'string', minLength: 1 },
    check: { type: 'string', minLength: 1 },
    /** Optional JSONata applicability test, evaluated per node before the rule runs. The rule applies only when it returns true. */
    when: { type: 'string', minLength: 1 },
    mode: { enum: ['expression', 'semantic'] },
    rubric: { type: 'string', minLength: 1 },
    /**
     * Semantic rules: the closed set of verdicts a judge may return. Each is a description (what the verdict
     * means, for the judge) or `{ description, guidance }`, where `guidance` is shown to the user when it fires.
     * Defaults to `pass`/`fail`.
     */
    verdicts: {
      type: 'object',
      additionalProperties: {
        oneOf: [
          { type: 'string', minLength: 1 },
          {
            type: 'object',
            properties: { description: { type: 'string', minLength: 1 }, guidance: { type: 'string', minLength: 1 } },
            required: ['description'],
            additionalProperties: false,
          },
        ],
      },
      minProperties: 2,
    },
    /** Semantic rules: name of the configured judge provider to use. A run-level override takes precedence. */
    judge: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    scope: { enum: ['global'] },
    override: { type: 'boolean' },
    /** Whether a violation of this rule gates (suppresses) downstream checks on the node's hierarchy subtree. Defaults to true for `error` severity rules and false otherwise. */
    gatesDescendants: { type: 'boolean' },
  },
  required: ['id', 'category', 'description'],
  // A global rule has no node to test, so `when` needs a per-node rule.
  not: { required: ['when', 'scope'] },
  // Semantic rules are judged per node (no `check`, not global) and with custom verdicts must map each failing
  // verdict to a severity. Every other rule needs a `check` and takes none of the semantic-only fields.
  if: { properties: { mode: { const: 'semantic' } }, required: ['mode'] },
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema `if`/`then`/`else` keyword, not a thenable
  then: {
    not: { anyOf: [{ required: ['check'] }, { required: ['scope'] }] },
    if: { required: ['verdicts'] },
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema `if`/`then`/`else` keyword, not a thenable
    then: { required: ['severity'], properties: { severity: { type: 'object' } } },
    else: { properties: { severity: { oneOf: [SEVERITY_SCHEMA, { type: 'object' }] } } },
  },
  else: {
    required: ['check'],
    not: { anyOf: [{ required: ['verdicts'] }, { required: ['rubric'] }, { required: ['judge'] }] },
    properties: { severity: SEVERITY_SCHEMA },
  },
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
