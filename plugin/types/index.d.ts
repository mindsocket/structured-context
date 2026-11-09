// What the mod keeps in `$.state`. The shapes mirror `scripts/mod-bridge.ts`, which the mod
// reaches through `$.process.run`: a hooks module cannot import Node code.

export type Counts = { errors: number; warnings: number };

export type ReportedIssue = { file: string; severity: 'error' | 'warning'; message: string };

export type SpaceReport = Counts & { name: string; path: string; added: ReportedIssue[]; fixed: number };

export type TurnReport = { at: number; spaces: SpaceReport[] };

export type ModStatus = { report: TurnReport | null; spaces: (Counts & { name: string })[] };

export type SchemaDigest = { space: string; text: string };

export type CwdContext = { spaces: string[]; digests: SchemaDigest[] };

export type PaneValidation = {
  nodeErrors: { nodeId: string; issues: { message: string }[] }[];
  hierarchyViolations: { nodeId: string; description: string }[];
  ruleViolations: { nodeId?: string; ruleId?: string; severity: 'error' | 'warning' | 'info'; description: string }[];
};

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
