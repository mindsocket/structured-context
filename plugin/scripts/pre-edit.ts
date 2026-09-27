#!/usr/bin/env bun
/**
 * PreToolUse hook for Write and Edit on *.md files.
 * Fallback for spaces the prompt hook didn't cover (outside the session's directory): the first
 * edit to such a space this turn baselines the whole space before the change.
 */

import { contains, type HookOptions, listSpaces, loadState, recordBaselines, saveState, stateFilePath } from './state';

export interface PreEditInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
  };
  session_id?: string;
}

export async function runPreEdit(input: PreEditInput, options?: HookOptions): Promise<void> {
  const FILE_PATH = input.tool_input?.file_path;
  if (!FILE_PATH) return;

  const STATE_FILE = stateFilePath(input.session_id, options);
  const state = loadState(STATE_FILE);
  if (Object.values(state.baseline).some((snap) => contains(snap.path, FILE_PATH))) return;

  const { configFiles, spaces } = await listSpaces(options);
  const containing = spaces.filter((space) => contains(space.path, FILE_PATH));
  if (await recordBaselines(state, containing, configFiles, options)) {
    saveState(STATE_FILE, state);
  }
}

async function main() {
  const INPUT = JSON.parse(await Bun.stdin.text()) as PreEditInput;
  await runPreEdit(INPUT);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
