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

/** The verdicts the evaluation reserves besides a rule's own; a verdict map may set a severity for them. */
export const RESERVED_VERDICTS = ['missing-context'] as const;

const VERDICT_SEVERITY_SCHEMA = { enum: ['error', 'warning', 'info', 'ignore'] } as const;

/** The semantic part of a rule: a model evaluates the node against a rubric and returns a verdict. */
const SEMANTIC_SCHEMA = {
  type: 'object',
  properties: {
    /** What the model judges the node against. Falls back to the rule's `description`. */
    rubric: { type: 'string', minLength: 1 },
    /**
     * The closed set of verdicts the model may return. Each is a description (what the verdict means, for the
     * model) or `{ description, guidance }`, where `guidance` is shown to the user when it fires.
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
    /**
     * Severity per verdict in effect (declared, default or reserved). A verdict mapped to `ignore` is judged but
     * not reported, and a verdict left out passes. Required with `verdicts`; with the default verdicts, `fail`
     * takes the rule's own `severity` instead.
     */
    severity: {
      type: 'object',
      additionalProperties: VERDICT_SEVERITY_SCHEMA,
      minProperties: 1,
    },
  },
  additionalProperties: false,
} as const;

const RULE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    category: { enum: ['validation', 'coherence', 'workflow', 'best-practice'] },
    /**
     * Severity of a failed `expression` and of the default `fail` verdict. Defaults from the category.
     */
    severity: SEVERITY_SCHEMA,
    description: { type: 'string', minLength: 1 },
    /** JSONata test a node must pass. When the rule also has `semantic`, a failing node is reported without being evaluated by the model. */
    expression: { type: 'string', minLength: 1 },
    /** Optional JSONata applicability condition, evaluated per node before the rule runs. The rule applies only when it returns true. */
    when: { type: 'string', minLength: 1 },
    /** A model evaluates the node against a rubric. `{}` takes every default; `true` means the same. */
    semantic: { oneOf: [{ const: true }, SEMANTIC_SCHEMA] },
    type: { type: 'string', minLength: 1 },
    /** Run once for the whole space instead of once per node. */
    global: { type: 'boolean' },
    override: { type: 'boolean' },
    /** Whether a failure of this rule gates (suppresses) downstream rules on the node's hierarchy subtree. Defaults to true when the failure's severity is `error`. */
    gatesDescendants: { type: 'boolean' },
  },
  required: ['id', 'category', 'description'],
  additionalProperties: false,
  allOf: [
    // A rule has an expression, a semantic part, or both.
    { anyOf: [{ required: ['expression'] }, { required: ['semantic'] }] },
    // A global rule has no node to apply to or to evaluate.
    {
      if: { required: ['global'], properties: { global: { const: true } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema `if`/`then` keyword, not a thenable
      then: { not: { anyOf: [{ required: ['when'] }, { required: ['type'] }, { required: ['semantic'] }] } },
    },
    // Custom verdicts need a severity for each failing verdict.
    {
      if: { required: ['semantic'], properties: { semantic: { type: 'object', required: ['verdicts'] } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema `if`/`then` keyword, not a thenable
      then: { properties: { semantic: { type: 'object', required: ['severity'] } } },
    },
    // With the default verdicts, `fail` takes the rule's severity.
    {
      if: { required: ['semantic'], properties: { semantic: { type: 'object', not: { required: ['verdicts'] } } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema `if`/`then` keyword, not a thenable
      then: {
        properties: {
          semantic: { type: 'object', properties: { severity: { type: 'object', not: { required: ['fail'] } } } },
        },
      },
    },
    // A rule with custom verdicts and no expression has no failure for the top-level severity to describe.
    {
      if: {
        required: ['semantic'],
        properties: { semantic: { type: 'object', required: ['verdicts'] } },
        not: { required: ['expression'] },
      },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema `if`/`then` keyword, not a thenable
      then: { not: { required: ['severity'] } },
    },
  ],
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
export type RuleSemantic = FromSchema<typeof SEMANTIC_SCHEMA>;
export type MetadataRef = FromSchema<typeof REF_SCHEMA>;
