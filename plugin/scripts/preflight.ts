#!/usr/bin/env bun

/**
 * SessionStart hook: check once, for the session's directory, that structured-context can run and
 * that its config is usable. Reports a failure to the user and the agent here, so the other hooks
 * can stay silent on the same failures. It also tells the agent which spaces apply. With no config it
 * says nothing: setting up is something the user asks for.
 *
 * Content problems (validation errors in notes) are not checked here; the other hooks report those.
 */

import { runSafely } from './safe';
import { contains, type HookOptions, parseSpacesOutput, runSctx, type SpacesOutput } from './state';

export interface PreflightInput {
  session_id?: string;
  cwd?: string;
}

export interface PreflightResult {
  /** Shown to the user */
  systemMessage?: string;
  /** Added to the agent's context */
  additionalContext?: string;
}

const TROUBLESHOOTING = "The structured-context skill's Troubleshooting section explains each code.";

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

function unavailable(code: string, message: string, fix: string): PreflightResult {
  return {
    systemMessage: `structured-context: validation hooks are inactive (${code}). ${message} ${fix}`,
    additionalContext: `structured-context hooks are inactive for this session. ${code}: ${message} Fix: ${fix} Help the user resolve this when they ask or when it blocks their work. ${TROUBLESHOOTING}`,
  };
}

export async function runPreflight(input: PreflightInput, options?: HookOptions): Promise<PreflightResult> {
  const run = await runSctx(['spaces', '--json'], { ...options, cwd: input.cwd ?? options?.cwd });
  const detail = firstLine(run.stderr) || `exit code ${run.exitCode}`;

  if (run.exitCode === null || !run.stdout.trim()) {
    return unavailable(
      'E_SCTX_UNAVAILABLE',
      `Could not run \`${run.command}\` (${detail}).`,
      'Check that Bun is installed and on the PATH and that the network is reachable (bunx downloads structured-context on first use), or install it with `bun install -g structured-context`. Then start a new session.',
    );
  }

  const output: SpacesOutput | undefined = parseSpacesOutput(run.stdout);
  if (!output?.problems || !output.config) {
    return unavailable(
      'E_SCTX_OUTDATED',
      'The installed structured-context is older than this plugin expects.',
      'Update it with `bun install -g structured-context@latest`, then start a new session.',
    );
  }

  const errors = output.problems.filter((p) => p.severity === 'error');
  if (errors.length > 0) {
    const lines = errors.map((p) => `- ${p.code}: ${p.message}${p.fix ? ` Fix: ${p.fix}` : ''}`).join('\n');
    return {
      systemMessage: `structured-context: validation hooks are inactive (${errors[0]!.code}). ${errors[0]!.message}`,
      additionalContext: `structured-context hooks are inactive for this session because of its configuration (${output.config.path}):\n${lines}\nHelp the user resolve this when they ask or when it blocks their work. ${TROUBLESHOOTING}`,
    };
  }

  // Not set up yet is not a failure and not worth interrupting the session for
  if (!output.config.exists) return {};

  const cwd = input.cwd ?? process.cwd();
  const related = output.spaces.filter((space) => contains(cwd, space.path) || contains(space.path, cwd));
  if (output.spaces.length === 0) return {};
  if (related.length === 0) return {};

  const list = related.map((s) => `${s.name} (${s.path}${s.schema ? `, schema ${s.schema}` : ''})`).join('; ');
  return {
    additionalContext: `structured-context spaces here: ${list}. Validation runs around your edits to these files and new errors block the turn from finishing. Use the structured-context skill when working on this content.`,
  };
}

async function main() {
  let input: PreflightInput = {};
  await runSafely(
    'preflight',
    () => input.session_id,
    async () => {
      input = JSON.parse(await Bun.stdin.text()) as PreflightInput;
      const result = await runPreflight(input);
      if (result.systemMessage || result.additionalContext) {
        console.log(
          JSON.stringify({
            ...(result.systemMessage && { systemMessage: result.systemMessage }),
            ...(result.additionalContext && {
              hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: result.additionalContext },
            }),
          }),
        );
      }
    },
  );
}

if (import.meta.main) {
  await main();
}
