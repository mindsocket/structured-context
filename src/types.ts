export interface SpaceNode {
  /** Source identifier for error messages (filename or heading title) */
  label: string;
  /** Fields validated against the active schema. */
  schemaData: Record<string, unknown>;
  /** Valid navigation targets this node can be linked to (wikilink key without [[ ]]). */
  linkTargets: string[];
  /** Resolved canonical parent title (derived from schemaData.parent + linkTargets). */
  resolvedParent?: string;
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
