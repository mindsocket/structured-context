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

/** Unique key of a node within a space. Supplied by the plugin that produced the node. */
export type NodeId = string & { readonly __brand: 'NodeId' };

/**
 * A resolved parent reference, capturing not just the parent id but the edge context
 * from which it was resolved. All hierarchy levels and relationships produce entries of
 * this type, forming a single labelled graph rather than separate structures.
 */
export type ResolvedParentRef = {
  /** Id of the parent node. */
  id: NodeId;
  /** The field name that contained the wikilink (e.g. 'parent', 'key_activities', 'produces_data'). */
  field: string;
  /** Whether this edge originates from a hierarchy level or a relationship definition. */
  kind: 'hierarchy' | 'relationship';
  /** Name of the hierarchy the edge belongs to. Set only when kind is 'hierarchy'. */
  hierarchy?: string;
  /** Whether the parent and child are the same node type (self-referential edge). */
  selfRef: boolean;
  /** Whether the edge field is on the child node (default) or on the parent node (fieldOn:'parent' edges). */
  fieldOn: 'child' | 'parent';
};

export type SourceLocation = {
  /** File path relative to the space root. */
  file: string;
  /** 1-indexed starting line number in the source file, if available. */
  line?: number;
  /** 1-indexed starting column number in the source file, if available. */
  column?: number;
};

export type UnresolvedRef = {
  /** Id of the node containing the broken link. */
  id: NodeId;
  /** Raw wikilink value (or String(rawField) for invalid_shape). */
  ref: string;
  /** Field name that contained the link. */
  field: string;
  reason: 'not_found' | 'ambiguous' | 'invalid_shape';
  /** Human-readable message matching validate-graph output format. */
  message: string;
  /** Source location of the node containing the broken link, if available. */
  source?: SourceLocation;
};

/**
 * Shared fields for all content link variants.
 */
type ContentLinkBase = {
  /** Display text of the link (text content for markdown links, inner text or target for wikilinks). */
  text: string;
  /** Raw link target: URL for markdown links, wikilink path (without [[ ]]) for wikilinks. */
  target: string;
  /** Whether the link navigates to a resource or transcludes/embeds it. */
  action: 'link' | 'embed';
  /** Anchor fragment (heading or block ref, e.g. 'heading-title' or '^blockid') if present. */
  anchor?: string;
};

/**
 * A link extracted from node content at parse time, before location classification.
 * Populated by plugins that support content link extraction (e.g. the markdown plugin).
 */
export type ContentLink = ContentLinkBase & {
  /** Link syntax — used during resolution to determine how to classify the target. */
  linkSyntax: 'wikilink' | 'markdown';
};

/**
 * A fully classified link from node content, after location resolution.
 * Present on SpaceNode after graph resolution.
 */
export type ResolvedContentLink = ContentLinkBase & {
  /**
   * Resolved location classification:
   * - 'node'     — wikilink resolved to a known space node
   * - 'internal' — wikilink or relative path, in the source system but not a space node
   * - 'external' — http/https URL
   * - 'system'   — file:// URL
   * - 'protocol' — other scheme (e.g. obsidian://, mailto:)
   */
  location: 'node' | 'internal' | 'external' | 'system' | 'protocol';
};

/**
 * A node as produced by a parse plugin — raw type from content, no graph resolution applied.
 * Core enriches this into a SpaceNode after parsing.
 */
export type BaseNode = {
  /** Unique key of the node: graph key, parent lookup, gating, duplicate detection and the file in messages. Supplied by the plugin. */
  id: NodeId;
  /** Display title (from schemaData.title). May repeat across nodes. */
  title: string;
  /** Fields validated against the active schema. */
  schemaData: Record<string, unknown>;
  /** Valid navigation targets this node can be linked to (wikilink key without [[ ]]). */
  linkTargets: string[];
  /** Raw type string from content, as written by the user. */
  type: string;
  /** Markdown source of the node's body, if any. First-class accessor mirroring schemaData.content. */
  content?: string;
  /**
   * Links extracted from content body and non-edge string fields at parse time.
   * Populated by plugins that support content link extraction; absent if not populated.
   */
  contentLinks?: ContentLink[];
  /** Source location of the node definition in the filesystem. */
  source?: SourceLocation;
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
   * Each entry carries the parent id, the field it came from, and its edge context.
   * Always present, empty if no parents resolved.
   */
  resolvedParents: ResolvedParentRef[];
  /**
   * Links from content body and non-edge fields, with location classified after graph resolution.
   * Always present, empty if the plugin did not populate rawContentLinks.
   */
  resolvedLinks: ResolvedContentLink[];
};

/** A problem a plugin found reading the source, such as a file it could not make a node from. */
export type ParseIssue = {
  /** The file (or item) and, if known, where in it. */
  source: SourceLocation;
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

/**
 * Rule violation severity. Only `error` fails validation; `warning` and `info` are reported only.
 * A rule's severity defaults from its category and may be overridden per rule.
 */
export type RuleSeverity = 'error' | 'warning' | 'info';

export type GraphViolation = {
  /** Id of the node whose parent link breaks the hierarchy. */
  nodeId: NodeId;
  nodeType: string;
  nodeTitle: string;
  parentType: string;
  parentTitle: string;
  description: string;
};

/** A named hierarchy, normalized from a schema's `$metadata.hierarchy`. */
export type Hierarchy = {
  /** Declared short name, defaulting to the declaring schema's file stem. */
  name: string;
  levels: HierarchyLevel[]; // full per-level config
  allowSkipLevels?: boolean;
};

export type SchemaMetadata = {
  /** Main hierarchy: used for space_on_a_page parsing, embedding, template-sync and default rendering. */
  hierarchy?: Hierarchy;
  /** Every hierarchy in the composed schema (main included), in composition order. Each type belongs to at most one. */
  hierarchies?: Hierarchy[];
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
  /** Content links that reach neither a node nor an excluded page. */
  unresolvedContentLinks: Array<{ nodeId: NodeId; target: string }>;
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

/** The checks a validation issue can come from. */
export const VALIDATION_ISSUE_KINDS = [
  'parse',
  'schema',
  'duplicate',
  'broken-link',
  'hierarchy',
  'rule',
  'gated',
  'content-link',
] as const;

export type ValidationIssueKind = (typeof VALIDATION_ISSUE_KINDS)[number];

/** What every validation issue has, whatever its kind. */
type IssueBase<K extends ValidationIssueKind> = {
  /** The check it came from. */
  kind: K;
  /** Names the issue within its node (or file, or space), stably across runs, e.g. `rule:<ruleId>`. */
  key: string;
  /** How serious the issue is; only `error` fails validation. Read it rather than infer it from `kind`. */
  severity: RuleSeverity;
  message: string;
  /** The node the issue is about. Absent for parse issues and global rules. */
  nodeId?: NodeId;
  /** The node's source, or the file a parse issue is about. */
  source?: SourceLocation;
};

/** One finding of a validation run. `kind` also selects the fields the issue carries. */
export type ValidationIssue =
  /** A file that produced no nodes; `type` is the plugin's reason, such as `no-type` or `parse`. */
  | (IssueBase<'parse'> & Pick<ParseIssue, 'source' | 'type'>)
  /** A node that failed its type or its schema, one issue per field problem. */
  | (IssueBase<'schema'> & { nodeId: NodeId })
  /** An id used by more than one node; `sources` lists where each is defined. */
  | (IssueBase<'duplicate'> & { nodeId: NodeId; sources: SourceLocation[] })
  /** A link in a field that does not resolve to a node; `ref` is the link as written. */
  | (IssueBase<'broken-link'> & { nodeId: NodeId; ref: string; reason: string })
  /** A parent link that breaks the hierarchy. */
  | (IssueBase<'hierarchy'> & Omit<GraphViolation, 'description'>)
  /** A rule violation; `nodeId` is absent for a global rule. */
  | (IssueBase<'rule'> & {
      /** Id of the violated rule. Absent `nodeId` means a global rule. */
      ruleId: string;
      category: RuleCategory;
      /** What evaluation found: cited evidence or reasoning (semantic rules). */
      evidence?: string;
      /** The verdict that failed the rule (semantic rules). */
      verdict?: string;
      /** User-facing guidance declared for that verdict (semantic rules). */
      guidance?: string;
    })
  /** A node whose rules a gate suppressed (or, with `includeGated`, evaluated anyway). The gate's cause and
   * rule id are in the message; `gatedBy` names the gate, for grouping and styling. */
  | (IssueBase<'gated'> & {
      nodeId: NodeId;
      /** The node whose failure gated this one. */
      gatedBy: NodeId;
    })
  /** A content link to a target outside the space's nodes. */
  | (IssueBase<'content-link'> & { nodeId: NodeId; target: string });

export interface FileValidationResult {
  file: string;
  label: string;
  space: string;
  /** The file's node's issues of every severity. */
  issues: ValidationIssue[];
  /** Issues at `error` severity: only these fail validation. */
  errorCount: number;
  /** Issues at `warning` or `info` severity. */
  warningCount: number;
  inSpace: true;
}

export interface FileNotInSpaceResult {
  file: string;
  inSpace: false;
  message: string;
}

export type ValidateFileOutput = FileValidationResult | FileNotInSpaceResult;
