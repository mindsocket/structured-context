import type { AnySchemaObject, SchemaObject, ValidateFunction } from 'ajv';
import type { Config, SpaceConfig } from './config';
import type {
  MetadataContractHierarchyLevel,
  MetadataContractRelationship,
  Rule,
  SharedEdgeFields,
} from './schema/metadata-contract';

/**
 * Minimal normalized edge for graph resolution.
 * Derives routing fields from SharedEdgeFields to stay in sync with the schema.
 */
export interface EdgeDefinition extends Required<Pick<SharedEdgeFields, 'field' | 'fieldOn' | 'multiple'>> {
  type: string;
  parent: string;
}

/**
 * Normalized hierarchy level — all edge fields are required after schema.ts normalization.
 * The raw schema input type is MetadataContractHierarchyLevel (optional fields).
 */
export type HierarchyLevel = Omit<MetadataContractHierarchyLevel, 'field' | 'fieldOn' | 'multiple' | 'selfRef'> & {
  field: string;
  fieldOn: 'child' | 'parent';
  multiple: boolean;
  selfRef: boolean;
};

/**
 * Normalized relationship — edge routing fields are required after schema.ts normalization.
 * The raw schema input type is MetadataContractRelationship (optional edge fields).
 */
export type Relationship = Omit<MetadataContractRelationship, 'field' | 'fieldOn' | 'multiple'> & {
  field: string;
  fieldOn: 'child' | 'parent';
  multiple: boolean;
};

/**
 * A resolved parent reference, capturing not just the parent title but the edge context
 * from which it was resolved. All hierarchy levels and relationships produce entries of
 * this type, forming a single labelled graph rather than separate structures.
 */
export type ResolvedParentRef = {
  /** Canonical title of the parent node. */
  title: string;
  /** The field name that contained the wikilink (e.g. 'parent', 'key_activities', 'produces_data'). */
  field: string;
  /** Whether this edge originates from a hierarchy level or a relationship definition. */
  source: 'hierarchy' | 'relationship';
  /** Whether the parent and child are the same node type (self-referential edge). */
  selfRef: boolean;
  /** Whether the edge field is on the child node (default) or on the parent node (fieldOn:'parent' edges). */
  fieldOn: 'child' | 'parent';
};

export type UnresolvedRef = {
  /** Source identifier of the node containing the broken link. */
  label: string;
  /** Raw wikilink value (or String(rawField) for invalid_shape). */
  ref: string;
  /** Field name that contained the link. */
  field: string;
  reason: 'not_found' | 'ambiguous' | 'invalid_shape';
  /** Human-readable message matching validate-graph output format. */
  message: string;
};

/**
 * A node as produced by a parse plugin — raw type from content, no graph resolution applied.
 * Core enriches this into a SpaceNode after parsing.
 */
export type BaseNode = {
  /** Source identifier for error messages (filename or heading title) */
  label: string;
  /** Canonical title of the node (from schemaData.title). First-class accessor. */
  title: string;
  /** Fields validated against the active schema. */
  schemaData: Record<string, unknown>;
  /** Valid navigation targets this node can be linked to (wikilink key without [[ ]]). */
  linkTargets: string[];
  /** Raw type string from content, as written by the user. */
  type: string;
};

/**
 * A fully resolved node — enriched by core after plugin parsing.
 * Adds canonical type (after alias resolution) and resolved parent graph edges.
 */
export type SpaceNode = BaseNode & {
  /** Resolved canonical type (after applying type aliases from schema metadata). */
  resolvedType: string;
  /**
   * Resolved parent references derived from all edge fields (hierarchy levels + relationships).
   * Each entry carries the parent title, the field it came from, and its edge context.
   * Always present, empty if no parents resolved.
   */
  resolvedParents: ResolvedParentRef[];
};

export type ParseIssue = {
  /** Source identifier of the file or item (filename or heading title). */
  file: string;
  /** error: prevented the file from producing nodes; warning: file was silently excluded. */
  severity: 'error' | 'warning';
  /** no-type: no type field;
   *  parse: parse failure (syntax issue or unexpected content);
   *  plugins may choose to provide additional types. */
  type: 'no-type' | 'parse' | string;
  /** Human-readable detail. */
  message?: string;
};

/** Rule categories for organizing executable validation rules */
export type RuleCategory = 'validation' | 'coherence' | 'workflow' | 'best-practice';

export type { Rule } from './schema/metadata-contract';

export type RuleViolation = {
  file: string;
  ruleId: string;
  category: RuleCategory;
  description: string;
};

export type GraphViolation = {
  file: string;
  nodeType: string;
  nodeTitle: string;
  parentType: string;
  parentTitle: string;
  description: string;
};

export type SchemaMetadata = {
  hierarchy?: {
    levels: HierarchyLevel[]; // full per-level config
    allowSkipLevels?: boolean;
  };
  typeAliases?: Record<string, string>;
  rules?: Rule[];
  relationships?: Relationship[];
};

export type SchemaWithMetadata = SchemaObject & {
  metadata: SchemaMetadata;
};

export type ReadSpaceResult = {
  /** Fully resolved nodes produced by the plugin and enriched by core. */
  nodes: SpaceNode[];
  /** Issues encountered while parsing files — excluded files with reason and severity. */
  parseIssues: ParseIssue[];
  /** Plugin diagnostics: keyed scalar or list values. */
  diagnostics: Record<string, number | string | string[]>;
  /** Name of the plugin that produced the nodes. */
  source: string;
  /** Broken/invalid wikilink refs collected during graph edge resolution. */
  unresolvedRefs: UnresolvedRef[];
};

export type SpaceContext = {
  /** Matching space config entry. */
  space: SpaceConfig;
  /** Full loaded config. */
  config: Config;
  /** Absolute path to the resolved schema. */
  resolvedSchemaPath: string;
  /** Full loaded schema with metadata embedded. */
  schema: SchemaWithMetadata;
  /** Registry for resolving $ref in schema (maps $ref IDs to schema objects). */
  schemaRefRegistry: Map<string, AnySchemaObject>;
  /** Compiled AJV validator for the schema. */
  schemaValidator: ValidateFunction;
  /** Directory of the config file that defines this space. Used for resolving relative paths in plugin configs. */
  configDir: string;
};
