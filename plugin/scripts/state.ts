/**
 * Session state shared by the hooks, and the CLI calls that fill it.
 *
 * Each space gets a baseline when a prompt is submitted (or at the first edit to a space the
 * prompt hook didn't cover). The Stop hook validates the space again, reports issues missing
 * from the baseline, and clears it. `latest` keeps each space's most recent issue keys, which
 * are reused without validating while the space's content hash still matches.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface HookOptions {
  /** Overrides SCTX_STATE_DIR env var */
  stateDir?: string;
  /** Path to structured-context entry point. When set, uses `bun run <path>` instead of `bunx structured-context`. */
  sctxBin?: string;
  /** Path to config file. When set, passed as SCTX_CONFIG to the CLI subprocess. */
  configPath?: string;
}

export interface ValidationIssue {
  kind: string;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

export interface FileIssues {
  errors: Record<string, ValidationIssue>;
  warnings: Record<string, ValidationIssue>;
}

/** A space's issue keys at a point in time */
export interface SpaceIssueKeys {
  path: string;
  hash: string;
  /** Issue keys by file label; files without issues are omitted. Space-level issues use the label ''. */
  issues: Record<string, string[]>;
}

export interface SessionState {
  /** Per space: issue keys before this turn's changes. Cleared by the Stop hook. */
  baseline: Record<string, SpaceIssueKeys>;
  /** Per space: the most recent issue keys, reused while the hash still matches */
  latest: Record<string, SpaceIssueKeys>;
}

export interface SpaceInfo {
  name: string;
  path: string;
  schema?: string;
}

interface SpacesOutput {
  configFiles: string[];
  spaces: SpaceInfo[];
}

interface ValidateOutput {
  errors?: Record<string, Record<string, ValidationIssue>>;
  ruleViolations?: { file?: string; ruleId: string; severity: 'error' | 'warning' | 'info'; description: string }[];
  parseIssues?: { file: string; severity: 'error' | 'warning'; type: string; message?: string }[];
  unresolvedContentLinks?: { file: string; target: string }[];
}

export function stateFilePath(sessionId: string | undefined, options?: HookOptions): string {
  const dir = options?.stateDir ?? process.env.SCTX_STATE_DIR ?? '/tmp';
  return join(dir, `sctx-hook-${sessionId ?? 'unknown'}.json`);
}

export function loadState(file: string): SessionState {
  if (!existsSync(file)) return { baseline: {}, latest: {} };
  const state = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SessionState>;
  return { baseline: state.baseline ?? {}, latest: state.latest ?? {} };
}

export function saveState(file: string, state: SessionState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

export function contains(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`);
}

async function sctx(args: string[], options?: HookOptions): Promise<string> {
  const BIN = options?.sctxBin ?? process.env.SCTX_BIN;
  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.configPath) {
    env.SCTX_CONFIG = options.configPath;
  }
  const proc = BIN
    ? Bun.$`bun run ${[BIN]} ${args}`.env(env).quiet().nothrow()
    : Bun.$`bunx structured-context ${args}`.env(env).quiet().nothrow();
  return proc.text();
}

/** Configured spaces whose path exists, and the config files they came from */
export async function listSpaces(options?: HookOptions): Promise<SpacesOutput> {
  const text = await sctx(['spaces', '--json'], options);
  if (!text) return { configFiles: [], spaces: [] };
  const output = JSON.parse(text) as SpacesOutput;
  return { ...output, spaces: output.spaces.filter((space) => existsSync(space.path)) };
}

/**
 * Hash the paths, sizes and modification times of every input to a space's validation:
 * its markdown files, the files in its schema's directory, and the config files.
 */
export function hashSpace(space: SpaceInfo, configFiles: string[]): string {
  const markdown = statSync(space.path).isDirectory()
    ? [...new Bun.Glob('**/*.md').scanSync({ cwd: space.path, absolute: true, followSymlinks: true })]
    : [space.path];
  // The schema's directory holds the partials it can reference
  const schemaDir = space.schema && existsSync(space.schema) ? dirname(space.schema) : undefined;
  const schemaFiles = schemaDir ? [...new Bun.Glob('*.json').scanSync({ cwd: schemaDir, absolute: true })] : [];

  const hasher = new Bun.CryptoHasher('sha1');
  for (const file of [...markdown, ...schemaFiles, ...configFiles].sort()) {
    try {
      const { size, mtimeMs } = statSync(file);
      hasher.update(`${file}\t${size}\t${mtimeMs}\n`);
    } catch {
      hasher.update(`${file}\tmissing\n`);
    }
  }
  return hasher.digest('hex');
}

/**
 * Validate a whole space and group its errors and warnings by file label.
 * Info-level rule violations are left out: they are not worth another turn from Claude.
 */
export async function validateSpace(name: string, options?: HookOptions): Promise<Record<string, FileIssues>> {
  const text = await sctx(['validate', name, '--json'], options);
  if (!text) return {};
  const output = JSON.parse(text) as ValidateOutput;

  const byFile: Record<string, FileIssues> = {};
  const issuesFor = (label: string): FileIssues => {
    byFile[label] ??= { errors: {}, warnings: {} };
    return byFile[label];
  };

  for (const [label, errors] of Object.entries(output.errors ?? {})) {
    Object.assign(issuesFor(label).errors, errors);
  }
  for (const issue of output.parseIssues ?? []) {
    if (issue.severity === 'error') {
      issuesFor(issue.file).errors[`parse:${issue.type}`] = {
        kind: 'parse',
        message: issue.message ?? `Could not parse (${issue.type})`,
      };
    }
  }
  for (const v of output.ruleViolations ?? []) {
    const issue = { kind: 'rule', message: `[${v.ruleId}] ${v.description}`, severity: v.severity };
    // File-level rule errors are already in `errors`
    if (v.severity === 'error' && !v.file) issuesFor('').errors[`rule:${v.ruleId}`] = issue;
    if (v.severity === 'warning') issuesFor(v.file ?? '').warnings[`rule:${v.ruleId}`] = issue;
  }
  for (const { file, target } of output.unresolvedContentLinks ?? []) {
    issuesFor(file).warnings[`content-link:${target}`] = {
      kind: 'content-link',
      message: `Unresolved content link: ${target}`,
    };
  }
  return byFile;
}

export function issueKeys(byFile: Record<string, FileIssues>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(byFile).map(([label, { errors, warnings }]) => [
      label,
      [...Object.keys(errors), ...Object.keys(warnings)],
    ]),
  );
}

/**
 * Record a baseline for each space that doesn't have one yet, reusing the latest issue keys
 * when the space's hash still matches them. Returns whether anything was recorded.
 */
export async function recordBaselines(
  state: SessionState,
  spaces: SpaceInfo[],
  configFiles: string[],
  options?: HookOptions,
): Promise<boolean> {
  const pending = spaces.filter((space) => !state.baseline[space.name]);
  await Promise.all(
    pending.map(async (space) => {
      const hash = hashSpace(space, configFiles);
      const latest = state.latest[space.name];
      const keys =
        latest?.hash === hash
          ? latest
          : { path: space.path, hash, issues: issueKeys(await validateSpace(space.name, options)) };
      state.latest[space.name] = keys;
      state.baseline[space.name] = keys;
    }),
  );
  return pending.length > 0;
}
