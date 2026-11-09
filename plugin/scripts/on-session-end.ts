#!/usr/bin/env bun
/** SessionEnd hook: remove the session's state file and kept validation results. */

import { rmSync } from 'node:fs';
import { type HookOptions, resultsDirPath, stateFilePath } from './state';

export function runOnSessionEnd(input: { session_id?: string }, options?: HookOptions): void {
  const stateFile = stateFilePath(input.session_id, options);
  rmSync(stateFile, { force: true });
  rmSync(resultsDirPath(stateFile), { recursive: true, force: true });
}

if (import.meta.main) {
  try {
    runOnSessionEnd(JSON.parse(await Bun.stdin.text()));
  } catch {
    // Nothing to clean up that matters; never fail the session end
  }
}
