export interface HierarchyLevel {
  type: string;
  field: string; // default "parent"
  fieldOn: 'child' | 'parent'; // default "child" - "parent" means the parent node has the field pointing to children
  multiple: boolean; // default false - when true, field is an array of wikilinks
  selfRef: boolean; // default false - when true, a node of this type may have a parent of the same type
}

export interface SpaceNode {
  /** Source identifier for error messages (filename or heading title) */
  label: string;
  /** Fields validated against the active schema. */
  schemaData: Record<string, unknown>;
  /** Valid navigation targets this node can be linked to (wikilink key without [[ ]]). */
  linkTargets: string[];
  /** Resolved canonical parent titles (derived from edge fields + linkTargets). Always present, empty if no parents. */
  resolvedParents: string[];
  /** Resolved canonical type (after applying type aliases from schema metadata). */
  resolvedType: string;
}

export interface SpaceOnAPageDiagnostics {
  /** Top-level mdast nodes before the first heading (ignored as preamble). */
  preambleNodeCount: number;
  /** Heading titles encountered after the --- terminator (space nodes that were not parsed). */
  terminatedHeadings: string[];
}

export interface SpaceOnAPageReadResult {
  nodes: SpaceNode[];
  diagnostics: SpaceOnAPageDiagnostics;
}

export interface SpaceDirectoryReadResult {
  nodes: SpaceNode[];
  skipped: string[]; // files with no frontmatter
  nonSpace: string[]; // files with frontmatter but no type field
}

/** Rule categories for organizing executable validation rules */
export type RuleCategory = 'validation' | 'coherence' | 'workflow' | 'best-practice';

/** A single executable rule with JSONata check expression */
export interface Rule {
  id: string;
  description: string;
  /** JSONata expression that evaluates to boolean (true = pass) */
  check: string;
  /** If set, only applies to nodes of this resolved type */
  type?: string;
  /** If 'global', evaluated once against the full node set rather than per node */
  scope?: 'global';
}

export interface RulesMetadata {
  validation?: Rule[];
  coherence?: Rule[];
  workflow?: Rule[];
  bestPractice?: Rule[];
}

export interface RuleViolation {
  file: string;
  ruleId: string;
  category: RuleCategory;
  description: string;
}

export interface HierarchyViolation {
  file: string;
  nodeType: string;
  nodeTitle: string;
  parentType: string;
  parentTitle: string;
  description: string;
}

export interface SchemaMetadata {
  hierarchy: string[]; // derived type-name list (same length/order as levels)
  levels: HierarchyLevel[]; // full per-level config
  typeAliases?: Record<string, string>;
  allowSkipLevels?: boolean;
  rules?: RulesMetadata;
}
