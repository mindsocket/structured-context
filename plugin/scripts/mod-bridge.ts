#!/usr/bin/env bun
/**
 * The Claude Code mod (`hooks/register.tsx`) has no Node, so it reaches hook state and the CLI through
 * this script. Each subcommand prints JSON, except `sctx`, which passes the CLI's output through.
 *
 *   status <session_id>   the last Stop's report and each space's latest issue counts
 *   digest                the spaces inside or containing the working directory, with a schema summary of each
 *   sctx <args...>        run sctx the way the hooks do
 */

import { contains, type IssueCounts, listSpaces, loadState, runSctx, stateFilePath, type TurnReport } from './state';

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
  if (command === 'sctx') {
    const run = await runSctx(rest, { cwd: process.cwd() });
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    return run.exitCode ?? 1;
  }
  console.error('usage: mod-bridge.ts status <session_id> | digest | sctx <args...>');
  return 2;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
