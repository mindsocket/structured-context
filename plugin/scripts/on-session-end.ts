#!/usr/bin/env bun
/** SessionEnd hook: remove the session's state file. */

import { rmSync } from 'node:fs';
import { type HookOptions, stateFilePath } from './state';

export function runOnSessionEnd(input: { session_id?: string }, options?: HookOptions): void {
  rmSync(stateFilePath(input.session_id, options), { force: true });
}

if (import.meta.main) {
  runOnSessionEnd(JSON.parse(await Bun.stdin.text()));
}
