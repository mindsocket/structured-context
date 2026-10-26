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
  /** Directory the CLI runs in, which is where config discovery starts. Defaults to the hook's own. */
  cwd?: string;
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
  /** Hook failure codes already shown to the user this session, so each is reported once. */
  reported?: string[];
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

export interface ConfigProblem {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix: string;
  space?: string;
}

export interface SpacesOutput {
  configFiles: string[];
  spaces: SpaceInfo[];
  /** Absent from an sctx that predates config health reporting */
  config?: { path: string; source: string; exists: boolean };
  problems?: ConfigProblem[];
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
  return { baseline: state.baseline ?? {}, latest: state.latest ?? {}, reported: state.reported };
}

export function saveState(file: string, state: SessionState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

export function contains(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`);
}

export interface SctxRun {
  stdout: string;
  stderr: string;
  /** Null when the process could not be started */
  exitCode: number | null;
  /** What was run, for messages */
  command: string;
}

/** Version of this plugin, which matches the structured-context release it was built with. */
function pluginVersion(): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', '.claude-plugin', 'plugin.json'), 'utf-8'));
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How to run sctx: an explicit entry point (`sctxBin` or SCTX_BIN), else an installed `sctx` on the
 * path, else `bunx` pinned to this plugin's version so the CLI matches the hooks.
 */
export function sctxCommand(options?: HookOptions): string[] {
  const bin = options?.sctxBin ?? process.env.SCTX_BIN;
  if (bin) return ['bun', 'run', bin];
  const installed = Bun.which('sctx');
  if (installed) return [installed];
  const version = pluginVersion();
  return ['bunx', version ? `structured-context@${version}` : 'structured-context'];
}

/** Run an sctx command from `cwd`. Never throws: a failure to start comes back as `exitCode: null`. */
export async function runSctx(args: string[], options?: HookOptions): Promise<SctxRun> {
  const argv = [...sctxCommand(options), ...args];
  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.configPath) {
    env.SCTX_CONFIG = options.configPath;
  }
  // A missing directory would make the spawn fail with a misleading error about the executable
  const cwd = options?.cwd && existsSync(options.cwd) ? options.cwd : undefined;
  try {
    const proc = Bun.spawn(argv, { env, cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, command: argv.join(' ') };
  } catch (err) {
    return { stdout: '', stderr: (err as Error).message, exitCode: null, command: argv.join(' ') };
  }
}

async function sctx(args: string[], options?: HookOptions): Promise<string> {
  return (await runSctx(args, options)).stdout;
}

/** Parse `sctx spaces --json` output, or undefined when it isn't usable. */
export function parseSpacesOutput(text: string): SpacesOutput | undefined {
  try {
    const output = JSON.parse(text) as SpacesOutput;
    return Array.isArray(output.spaces) && Array.isArray(output.configFiles) ? output : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Configured spaces whose path exists, and the config files they came from. Any failure to get a
 * usable answer returns no spaces: the SessionStart hook is what tells the user about those.
 */
export async function listSpaces(options?: HookOptions): Promise<SpacesOutput> {
  const output = parseSpacesOutput((await runSctx(['spaces', '--json'], options)).stdout);
  if (!output) return { configFiles: [], spaces: [] };
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
