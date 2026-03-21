import type { SchemaObject } from 'ajv';
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
  /** The frontmatter field name that contained the wikilink (e.g. 'parent', 'key_activities', 'produces_data'). */
  field: string;
  /** Whether this edge originates from a hierarchy level or a relationship definition. */
  source: 'hierarchy' | 'relationship';
  /** Whether the parent and child are the same node type (self-referential edge). */
  selfRef: boolean;
};

export type SpaceNode = {
  /** Source identifier for error messages (filename or heading title) */
  label: string;
  /** Fields validated against the active schema. */
  schemaData: Record<string, unknown>;
  /** Valid navigation targets this node can be linked to (wikilink key without [[ ]]). */
  linkTargets: string[];
  /**
   * Resolved parent references derived from all edge fields (hierarchy levels + relationships).
   * Each entry carries the parent title, the field it came from, and its edge context.
   * Always present, empty if no parents resolved.
   */
  resolvedParents: ResolvedParentRef[];
  /** Resolved canonical type (after applying type aliases from schema metadata). */
  resolvedType: string;
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
  nodes: SpaceNode[];
  /** Name of the plugin that produced the nodes. */
  source: string;
  /** Paths/items skipped during parsing. */
  parseIgnored?: string[];
  /** Plugin diagnostics: keyed scalar or list values. */
  diagnostics?: Record<string, number | string | string[]>;
};
