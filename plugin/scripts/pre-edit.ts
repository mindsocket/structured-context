#!/usr/bin/env bun
/**
 * PreToolUse hook for Write and Edit on *.md files.
 * Write (new files): records the filename with no baseline errors.
 * Edit (existing files): validates before the edit and records baseline errors.
 * Appends one JSONL line to a per-session state file for the Stop hook to analyse.
 */

import { appendFileSync, mkdirSync } from 'node:fs';

export interface PreEditInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
  };
  session_id?: string;
}

export interface PreEditOptions {
  /** Overrides SCTX_STATE_DIR env var */
  stateDir?: string;
  /** Path to structured-context entry point. When set, uses `bun run <path>` instead of `bunx structured-context`. */
  sctxBin?: string;
  /** Path to config file. When set, passed as SCTX_CONFIG to validate-file subprocess. */
  configPath?: string;
}

interface HookState {
  session_id: string;
  timestamp: number;
  tool: 'Write' | 'Edit';
  file: string;
  errors: object | null;
}

interface ValidationResult {
  inSpace?: boolean;
  errors?: object;
}

export async function runPreEdit(input: PreEditInput, options?: PreEditOptions): Promise<void> {
  const TOOL = input.tool_name ?? '';
  const FILE_PATH = input.tool_input?.file_path;
  const SESSION_ID = input.session_id ?? 'unknown';

  if (!FILE_PATH) {
    return;
  }

  const STATE_DIR = options?.stateDir ?? process.env.SCTX_STATE_DIR ?? '/tmp';
  const STATE_FILE = `${STATE_DIR}/sctx-hook-${SESSION_ID}.jsonl`;
  const TIMESTAMP = Date.now();

  if (TOOL === 'Write') {
    const entry: HookState = {
      session_id: SESSION_ID,
      timestamp: TIMESTAMP,
      tool: 'Write',
      file: FILE_PATH,
      errors: null,
    };
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(STATE_FILE, `${JSON.stringify(entry)}\n`);
    return;
  }

  // Edit — validate current state as pre-edit baseline
  const BIN = options?.sctxBin ?? process.env.SCTX_BIN;
  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.configPath) {
    env.SCTX_CONFIG = options.configPath;
  }

  const proc = BIN
    ? Bun.$`bun run ${[BIN]} validate-file ${[FILE_PATH]} --json`.env(env).quiet().nothrow()
    : Bun.$`bunx structured-context validate-file ${[FILE_PATH]} --json`.env(env).quiet().nothrow();

  const resultText = await proc.text();
  const result = resultText ? (JSON.parse(resultText) as ValidationResult) : {};
  const IN_SPACE = result.inSpace ?? false;

  if (IN_SPACE !== true) {
    return;
  }

  const ERRORS = result.errors ?? {};
  const entry: HookState = {
    session_id: SESSION_ID,
    timestamp: TIMESTAMP,
    tool: 'Edit',
    file: FILE_PATH,
    errors: ERRORS,
  };
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(STATE_FILE, `${JSON.stringify(entry)}\n`);
}

async function main() {
  const INPUT_TEXT = await Bun.stdin.text();
  const INPUT = JSON.parse(INPUT_TEXT) as PreEditInput;
  await runPreEdit(INPUT);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
