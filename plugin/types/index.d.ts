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
  /** 1-indexed line number in source file, if available. */
  line?: number;
  /** 1-indexed column number in source file, if available. */
  column?: number;
};
/** Rule categories for organizing executable validation rules */
export type RuleCategory = 'validation' | 'coherence' | 'workflow' | 'best-practice';
/**
 * Rule violation severity. Only `error` fails validation; `warning` and `info` are reported only.
 * A rule's severity defaults from its category and may be overridden per rule.
 */
export type RuleSeverity = 'error' | 'warning' | 'info';
export type RuleViolation = {
  /** Id of the violating node. Absent for global-scope rules. */
  nodeId?: NodeId;
  ruleId: string;
  category: RuleCategory;
  severity: RuleSeverity;
  description: string;
  /** Cited evidence or reasoning from evaluation (for semantic judge rules). */
  evidence?: string;
  /** The verdict that failed the rule (semantic rules). */
  verdict?: string;
  /** User-facing guidance declared for that verdict (semantic rules). */
  guidance?: string;
};
export type ValidationIssueKind = (readonly [
  'schema',
  'duplicate',
  'broken-link',
  'hierarchy',
  'rule',
  'gated',
  'content-link',
])[number];
export interface FileValidationIssue {
  /** The check it came from. */
  kind: ValidationIssueKind;
  message: string;
  /** How serious the issue is; consumers read it rather than infer it from `kind`. */
  severity: RuleSeverity;
  /** 1-indexed line number in source file, if available. */
  line?: number;
  /** 1-indexed column number in source file, if available. */
  column?: number;
}
/** The parts of `validate --json` the pane reads, as validate gives them */
export type PaneValidation = {
  issues: Record<string, Record<string, FileValidationIssue>>;
  ruleViolations: RuleViolation[];
  parseIssues: ParseIssue[];
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
