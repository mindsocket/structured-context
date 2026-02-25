export interface OstNode {
  /** Source identifier for error messages (filename or heading title) */
  label: string;
  /** Schema-ready data: all fields including injected title */
  data: Record<string, unknown>;
}

export interface OstPageDiagnostics {
  /** Top-level mdast nodes before the first heading (ignored as preamble). */
  preambleNodeCount: number;
  /** Heading titles encountered after the --- terminator (OST nodes that were not parsed). */
  terminatedHeadings: string[];
}

export interface OstPageReadResult {
  nodes: OstNode[];
  diagnostics: OstPageDiagnostics;
}

export interface SpaceReadResult {
  nodes: OstNode[];
  skipped: string[];  // files with no frontmatter
  nonOst: string[];   // files with frontmatter but no type field
}
