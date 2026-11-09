// What the mod keeps in `$.state`. The shapes mirror `scripts/mod-bridge.ts`, which the mod
// reaches through `$.process.run`: a hooks module cannot import Node code.

export type Counts = { errors: number; warnings: number };

export type ReportedIssue = { file: string; severity: 'error' | 'warning'; message: string };

export type SpaceReport = Counts & { name: string; path: string; added: ReportedIssue[]; fixed: number };

export type TurnReport = { at: number; spaces: SpaceReport[] };

export type ModStatus = { report: TurnReport | null; spaces: (Counts & { name: string })[] };

export type SchemaDigest = { space: string; text: string };

export type CwdContext = { spaces: string[]; digests: SchemaDigest[] };

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
    };
  }
}
