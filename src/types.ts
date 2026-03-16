import type { SchemaObject } from 'ajv';
import type {
  MetadataContractRelationship,
  MetadataContractResolvedRules,
  MetadataContractRule,
} from './metadata-contract';

export interface HierarchyLevel {
  type: string;
  field: string; // default "parent"
  fieldOn: 'child' | 'parent'; // default "child" - "parent" means the parent node has the field pointing to children
  multiple: boolean; // default false - when true, field is an array of wikilinks
  selfRef: boolean; // default false - when true, a node of this type may have a parent of the same type
  selfRefField?: string; // optional field for same-type parent relationships (implies selfRef: true)
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
export type Rule = MetadataContractRule;
export type RulesMetadata = MetadataContractResolvedRules;

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
  hierarchy?: {
    levels: HierarchyLevel[]; // full per-level config
    allowSkipLevels?: boolean;
  };
  typeAliases?: Record<string, string>;
  rules?: RulesMetadata;
  relationships?: MetadataContractRelationship[];
}

export interface SchemaWithMetadata extends SchemaObject {
  $metadata?: SchemaMetadata;
}
