#!/usr/bin/env bun
/**
 * The Claude Code mod (`hooks/register.tsx`) has no Node, so it reaches hook state and the CLI through
 * this script. Each subcommand prints JSON, except `sctx`, which passes the CLI's output through.
 *
 *   status <session_id>   the last Stop's report and each space's latest issue counts
 *   digest                the spaces inside or containing the working directory, with a schema summary of each
 *   pane <session_id> <space>  a space's graph and validation results, for the map pane
 *   sctx <args...>        run sctx the way the hooks do
 */

import type { PaneValidation } from '../../scripts/mod-contract';
import {
  contains,
  type HookOptions,
  hashSpace,
  type IssueCounts,
  listSpaces,
  loadResult,
  loadState,
  resultsDirPath,
  runSctx,
  stateFilePath,
  type TurnReport,
  validateSpace,
} from './state';

export interface ModStatus {
  report: TurnReport | null;
  spaces: (IssueCounts & { name: string })[];
}

export interface SchemaDigest {
  space: string;
  text: string;
}

export function readStatus(sessionId: string, stateDir?: string): ModStatus {
  const state = loadState(stateFilePath(sessionId, { stateDir }));
  const spaces = Object.entries(state.latest).flatMap(([name, { counts }]) => (counts ? [{ name, ...counts }] : []));
  return { report: state.report ?? null, spaces };
}

/** `schemas show` up to its `$refs` list: types, fields, hierarchy and rules, without the registry detail */
export function trimSchemaShow(text: string): string {
  const end = text.indexOf('\n$refs:');
  return (end === -1 ? text : text.slice(0, end)).trim();
}

export interface CwdContext {
  spaces: string[];
  digests: SchemaDigest[];
}

export async function cwdContext(cwd: string, sctxBin?: string): Promise<CwdContext> {
  const options = { cwd, sctxBin };
  const { spaces } = await listSpaces(options);
  const related = spaces.filter((space) => contains(cwd, space.path) || contains(space.path, cwd));
  const shown = await Promise.all(
    related.map(async (space) => {
      const run = await runSctx(['schemas', 'show', '--space', space.name], options);
      return run.exitCode === 0 ? [{ space: space.name, text: trimSchemaShow(run.stdout) }] : [];
    }),
  );
  return { spaces: related.map((space) => space.name), digests: shown.flat() };
}

/** What the pane draws a space from */
export type { PaneValidation };

export interface PaneData {
  space: string;
  /** The space's directory (or file), to open its nodes' files from */
  path: string;
  /** `sctx dump --graph`, with node bodies and data left out: the pane draws titles, types and edges */
  graph: {
    hierarchies: ({ name: string } & Record<string, unknown>)[];
    mainHierarchy?: string;
    nodes: unknown[];
  } & Record<string, unknown>;
  validation: PaneValidation;
}

/**
 * A space's graph and validation results. The results the hooks kept this session are reused while
 * the space's content hash matches them; otherwise the space is validated now and the results kept.
 */
export async function paneData(sessionId: string, space: string, options: HookOptions): Promise<PaneData> {
  const { configFiles, spaces } = await listSpaces(options);
  const info = spaces.find((one) => one.name === space);
  if (!info) throw new Error(`No space named "${space}" in the config this directory finds.`);

  const dir = resultsDirPath(stateFilePath(sessionId, options));
  const hash = hashSpace(info, configFiles);
  if (loadResult(dir, space)?.hash !== hash) await validateSpace(space, options, { dir, hash });
  const output = loadResult(dir, space)!.output as Partial<PaneValidation>;

  const dump = await runSctx(['dump', space, '--graph'], options);
  if (dump.exitCode !== 0) {
    throw new Error(dump.stderr.trim().split('\n')[0] || `sctx dump exited with code ${dump.exitCode}`);
  }
  const graph = JSON.parse(dump.stdout) as PaneData['graph'];
  const nodes = (graph.nodes as Record<string, unknown>[]).map(
    ({ content: _content, contentLinks: _links, ...node }) => ({ ...node, schemaData: {} }),
  );
  return {
    space,
    path: info.path,
    graph: { ...graph, nodes },
    validation: { issues: output.issues ?? [] },
  };
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'status' && rest[0]) {
    console.log(JSON.stringify(readStatus(rest[0])));
    return 0;
  }
  if (command === 'digest') {
    console.log(JSON.stringify(await cwdContext(process.cwd())));
    return 0;
  }
  if (command === 'pane' && rest[0] && rest[1]) {
    try {
      console.log(JSON.stringify(await paneData(rest[0], rest[1], { cwd: process.cwd() })));
      return 0;
    } catch (err) {
      console.error((err as Error).message);
      return 1;
    }
  }
  if (command === 'sctx') {
    const run = await runSctx(rest, { cwd: process.cwd() });
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    return run.exitCode ?? 1;
  }
  console.error('usage: mod-bridge.ts status <session_id> | digest | pane <session_id> <space> | sctx <args...>');
  return 2;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
