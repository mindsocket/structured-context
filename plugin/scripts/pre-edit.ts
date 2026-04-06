#!/usr/bin/env bun
/**
 * PreToolUse hook for Write and Edit on *.md files.
 * Write (new files): records the filename with no baseline errors.
 * Edit (existing files): validates before the edit and records baseline errors.
 * Appends one JSONL line to a per-session state file for the Stop hook to analyse.
 */

import { appendFileSync, mkdirSync } from 'node:fs';

interface HookInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
  };
  session_id?: string;
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

async function main() {
  const INPUT_TEXT = await Bun.stdin.text();
  const INPUT = JSON.parse(INPUT_TEXT) as HookInput;

  // DEBUG: log full input and env to stderr
  console.error('[ost-tools pre-edit hook] input:', JSON.stringify(INPUT));
  console.error('[ost-tools pre-edit hook] OST_TOOLS_STATE_DIR:', process.env.OST_TOOLS_STATE_DIR);

  const TOOL = INPUT.tool_name ?? '';
  const FILE_PATH = INPUT.tool_input?.file_path;
  const SESSION_ID = INPUT.session_id ?? 'unknown';

  if (!FILE_PATH) {
    process.exit(0);
  }

  const STATE_DIR = process.env.OST_TOOLS_STATE_DIR ?? '/tmp';
  const STATE_FILE = `${STATE_DIR}/ost-tools-hook-${SESSION_ID}.jsonl`;
  const TIMESTAMP = Date.now();

  if (TOOL === 'Write') {
    // New file — record filename only, no baseline to establish
    const entry: HookState = {
      session_id: SESSION_ID,
      timestamp: TIMESTAMP,
      tool: 'Write',
      file: FILE_PATH,
      errors: null,
    };
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(STATE_FILE, `${JSON.stringify(entry)}\n`);
    process.exit(0);
  }

  // Edit — validate current state as pre-edit baseline
  const proc = Bun.$`bunx ost-tools validate-file ${FILE_PATH} --json`.quiet().nothrow();
  const resultText = await proc.text();
  const result = resultText ? (JSON.parse(resultText) as ValidationResult) : {};
  const IN_SPACE = result.inSpace ?? false;

  if (IN_SPACE !== true) {
    process.exit(0);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
