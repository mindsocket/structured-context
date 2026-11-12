// What the mod keeps in `$.state`. The shapes mirror `scripts/mod-bridge.ts`, which the mod
// reaches through `$.process.run`: a hooks module cannot import Node code.

export type Counts = { errors: number; warnings: number };

export type ReportedIssue = { file: string; severity: 'error' | 'warning'; message: string };

export type SpaceReport = Counts & { name: string; path: string; added: ReportedIssue[]; fixed: number };

export type TurnReport = { at: number; spaces: SpaceReport[] };

export type ModStatus = { report: TurnReport | null; spaces: (Counts & { name: string })[] };

export type SchemaDigest = { space: string; text: string };

export type CwdContext = { spaces: string[]; digests: SchemaDigest[] };

// BEGIN generated from scripts/mod-contract.ts by `bun run build:mod-projection`; do not edit
/** Unique key of a node within a space. Supplied by the plugin that produced the node. */
export type NodeId = string & {
  readonly __brand: 'NodeId';
};
export type SourceLocation = {
  /** File path relative to the space root. */
  file: string;
  /** 1-indexed starting line number in the source file, if available. */
  line?: number;
  /** 1-indexed starting column number in the source file, if available. */
  column?: number;
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
export type ValidationIssueKind = (readonly [
  'parse',
  'schema',
  'duplicate',
  'broken-link',
  'hierarchy',
  'rule',
  'gated',
  'content-link',
])[number];
/** What every validation issue has, whatever its kind. */
export type IssueBase<K extends ValidationIssueKind> = {
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
  | (IssueBase<'schema'> & {
      nodeId: NodeId;
    })
  /** An id used by more than one node; `sources` lists where each is defined. */
  | (IssueBase<'duplicate'> & {
      nodeId: NodeId;
      sources: SourceLocation[];
    })
  /** A link in a field that does not resolve to a node; `ref` is the link as written. */
  | (IssueBase<'broken-link'> & {
      nodeId: NodeId;
      ref: string;
      reason: string;
    })
  /** A parent link that breaks the hierarchy or a relationship's type constraint. */
  | (IssueBase<'hierarchy'> & {
      nodeId: NodeId;
      nodeType: string;
      nodeTitle: string;
      parentType: string;
      parentTitle: string;
    })
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
  | (IssueBase<'content-link'> & {
      nodeId: NodeId;
      target: string;
    });
/** The part of `validate --json` the pane reads, as validate gives it */
export type PaneValidation = {
  issues: ValidationIssue[];
};

// END generated

/** A space's graph (the space graph format, bodies left out) and validation results */
export type PaneData = {
  space: string;
  path: string;
  graph: {
    hierarchies: ({ name: string } & Record<string, unknown>)[];
    mainHierarchy?: string;
    nodes: unknown[];
  } & Record<string, unknown>;
  validation: PaneValidation;
};

/** What the map pane shows: a space, which hierarchy, and the data it last loaded */
export type MapView = {
  space?: string;
  /** Absent: the main hierarchy */
  hierarchy?: string;
  data?: PaneData;
  /** Why the last load failed */
  error?: string;
  /** True from a load's start until its data or error arrives */
  isLoading?: boolean;
  /** The `status.report.at` the data was loaded after, so a later report reloads it */
  loadedAt: number;
};

/** The node the person focused: its facts go with each prompt until they unfocus it */
export type FocusedNode = { space: string; id: string; title: string; type: string; file?: string; issues: string[] };

declare module 'claude-code' {
  interface PluginState {
    'structured-context': {
      /**
       * Refreshed after each prompt and Stop hook. A new `report.at` means a Stop validated the
       * spaces in `report.spaces` because they changed this turn.
       */
      status: Shaped<ModStatus | null>;
      /** The spaces inside or containing the session's directory, and their schema summaries */
      cwd: Shaped<CwdContext>;
      /** The `at` of the last report the person dismissed from the band */
      dismissedAt: number;
      /** The `at` of the last report summarised under an answer */
      summarisedAt: number;
      /** Whether the session edited a schema file since the digest was made */
      isDigestStale: boolean;
      /** The map pane's space, hierarchy and loaded data */
      map: Shaped<MapView>;
      /** Occurrence keys of the tree rows the person collapsed */
      collapsed: string[];
      /** The occurrence key of the row whose details the pane shows */
      selected: string | null;
      focused: Shaped<FocusedNode | null>;
    };
  }
}
