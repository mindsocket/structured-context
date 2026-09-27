#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: baseline every space inside or containing the session's directory.
 * A space keeps an existing baseline, which means the previous turn's Stop hook never ran
 * (e.g. the turn was interrupted), so its changes are still compared at the next Stop.
 */

import { contains, type HookOptions, listSpaces, loadState, recordBaselines, saveState, stateFilePath } from './state';

export interface OnPromptInput {
  session_id?: string;
  cwd?: string;
}

export async function runOnPrompt(input: OnPromptInput, options?: HookOptions): Promise<void> {
  if (!input.cwd) return;

  const CWD = input.cwd;
  const { configFiles, spaces } = await listSpaces(options);
  const related = spaces.filter((space) => contains(CWD, space.path) || contains(space.path, CWD));
  if (related.length === 0) return;

  const STATE_FILE = stateFilePath(input.session_id, options);
  const state = loadState(STATE_FILE);
  if (await recordBaselines(state, related, configFiles, options)) {
    saveState(STATE_FILE, state);
  }
}

async function main() {
  const INPUT = JSON.parse(await Bun.stdin.text()) as OnPromptInput;
  await runOnPrompt(INPUT);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
