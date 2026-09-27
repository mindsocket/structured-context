#!/usr/bin/env bun
/**
 * Stop hook: validate each space baselined this turn and report issues missing from its baseline,
 * in any file of the space. New errors block the stop; new warnings are passed back as context.
 */

import { join } from 'node:path';
import {
  type HookOptions,
  hashSpace,
  issueKeys,
  listSpaces,
  loadState,
  saveState,
  stateFilePath,
  type ValidationIssue,
  validateSpace,
} from './state';

export interface OnStopInput {
  session_id?: string;
  stop_hook_active?: boolean;
}

export interface OnStopResult {
  hasNewErrors: boolean;
  /** Present when hasNewErrors is true */
  errorMessage?: string;
  /** Present when new warnings were introduced. Reported to Claude without blocking as an error. */
  warningMessage?: string;
}

function formatIssues(header: string, issues: ValidationIssue[], noun: string): string {
  const lines = issues.map((issue) => `    [${issue.kind}] ${issue.message}`).join('\n');
  return `  ${header} — ${issues.length} new ${noun}(s):\n${lines}`;
}

export async function runOnStop(input: OnStopInput, options?: HookOptions): Promise<OnStopResult> {
  // Guard against infinite loop: stop hooks can trigger another stop cycle
  if (input.stop_hook_active === true) {
    return { hasNewErrors: false };
  }

  const STATE_FILE = stateFilePath(input.session_id, options);
  const state = loadState(STATE_FILE);
  if (Object.keys(state.baseline).length === 0) {
    return { hasNewErrors: false };
  }

  const { configFiles, spaces } = await listSpaces(options);

  const newErrors: string[] = [];
  const newWarnings: string[] = [];
  // Spaces can overlap, so report each issue in a file once
  const reported = new Set<string>();
  const unreported = (file: string, key: string) => {
    const id = `${file}\0${key}`;
    if (reported.has(id)) return false;
    reported.add(id);
    return true;
  };

  // A space whose hash still matches its baseline hasn't changed, so it needs no validation
  const hashes = new Map(
    spaces.filter((space) => state.baseline[space.name]).map((space) => [space.name, hashSpace(space, configFiles)]),
  );
  const changed = spaces.filter(
    (space) => hashes.has(space.name) && hashes.get(space.name) !== state.baseline[space.name]!.hash,
  );
  const results = await Promise.all(changed.map((space) => validateSpace(space.name, options)));

  changed.forEach((space, i) => {
    const byFile = results[i]!;
    const before = state.baseline[space.name]!.issues;

    for (const [label, issues] of Object.entries(byFile)) {
      const file = join(space.path, label);
      const HEADER = label ? `${label} (space: ${space.name})` : `space ${space.name}`;
      const known = new Set(before[label] ?? []);

      const fileErrors = Object.entries(issues.errors)
        .filter(([key]) => !known.has(key) && unreported(file, key))
        .map(([, issue]) => issue);
      if (fileErrors.length > 0) {
        newErrors.push(formatIssues(HEADER, fileErrors, 'error'));
      }

      const fileWarnings = Object.entries(issues.warnings)
        .filter(([key]) => !known.has(key) && unreported(file, key))
        .map(([, issue]) => issue);
      if (fileWarnings.length > 0) {
        newWarnings.push(formatIssues(HEADER, fileWarnings, 'warning'));
      }
    }

    state.latest[space.name] = { path: space.path, hash: hashes.get(space.name)!, issues: issueKeys(byFile) };
  });

  state.baseline = {};
  saveState(STATE_FILE, state);

  const warningMessage =
    newWarnings.length > 0
      ? `structured-context: new validation warnings introduced this turn - fix them with the structured-context skill if appropriate, otherwise mention them to the user:\n${newWarnings.join('\n')}`
      : undefined;

  if (newErrors.length > 0) {
    const errorMessage = `structured-context: new validation errors introduced this turn - use structured-context skill to resolve:\n${newErrors.join('\n')}`;
    return { hasNewErrors: true, errorMessage, ...(warningMessage && { warningMessage }) };
  }

  return { hasNewErrors: false, ...(warningMessage && { warningMessage }) };
}

async function main() {
  const INPUT_TEXT = await Bun.stdin.text();
  const INPUT = JSON.parse(INPUT_TEXT) as OnStopInput;
  const result = await runOnStop(INPUT);

  if (result.hasNewErrors) {
    // Exit 2 blocks the stop; stderr is fed back to Claude as the reason
    console.error([result.errorMessage, result.warningMessage].filter(Boolean).join('\n\n'));
    process.exit(2);
  }

  if (result.warningMessage) {
    // Non-error feedback: Claude gets another turn, but it isn't flagged as a hook error
    console.log(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: result.warningMessage } }),
    );
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
