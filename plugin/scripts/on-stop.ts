#!/usr/bin/env bun
/**
 * Stop hook: re-validates all markdown files touched during this session turn.
 * Compares fresh results against pre-edit baselines captured by the PreToolUse hook.
 * Exits 2 with error details on stderr if new violations were introduced; 0 otherwise.
 * Clears the session state file after analysis.
 */

export {};

interface HookInput {
  session_id?: string;
  stop_hook_active?: boolean;
}

interface HookState {
  session_id: string;
  timestamp: number;
  tool: 'Write' | 'Edit';
  file: string;
  errors: object | null;
}

interface ValidationError {
  kind: string;
  message: string;
}

interface ValidationResult {
  inSpace?: boolean;
  label?: string;
  space?: string;
  errors?: Record<string, ValidationError>;
}

const LOG_FILE = '/tmp/ost-tools-stop-hook.log';
const LOG_ENABLED = false;

function log(message: string): void {
  if (!LOG_ENABLED) return;
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const logMsg = `[${timestamp}] ${message}\n`;
  Bun.write(Bun.file(LOG_FILE), logMsg, { createPath: true });
}

async function main() {
  const INPUT_TEXT = await Bun.stdin.text();
  log(`INPUT=${INPUT_TEXT}`);

  const INPUT = JSON.parse(INPUT_TEXT) as HookInput;
  const SESSION_ID = INPUT.session_id ?? 'unknown';
  const STOP_HOOK_ACTIVE = INPUT.stop_hook_active ?? false;
  log(`SESSION_ID=${SESSION_ID}`);
  log(`STOP_HOOK_ACTIVE=${STOP_HOOK_ACTIVE}`);

  // Guard against infinite loop: stop hooks can trigger another stop cycle
  if (STOP_HOOK_ACTIVE === true) {
    log('Stop hook already active, exiting to avoid infinite loop');
    process.exit(0);
  }
  log('Stop hook not active, proceeding');

  const STATE_DIR = process.env.OST_TOOLS_STATE_DIR ?? '/tmp';
  const STATE_FILE = `${STATE_DIR}/ost-tools-hook-${SESSION_ID}.jsonl`;
  log(`STATE_FILE=${STATE_FILE}`);

  const stateFile = Bun.file(STATE_FILE);
  const stateFileExists = await stateFile.exists();
  if (!stateFileExists) {
    log('State file does not exist, exiting');
    process.exit(0);
  }
  log('State file exists, proceeding');

  const newErrors: string[] = [];
  let hasNewErrors = false;

  // Read all entries and keep only the latest per file (by timestamp)
  const lines = (await stateFile.text())
    .trim()
    .split('\n')
    .filter((l) => l);
  const entries: HookState[] = lines.map((l) => JSON.parse(l));

  // Group by file and keep latest
  const latestByFile = new Map<string, HookState>();
  for (const entry of entries) {
    const existing = latestByFile.get(entry.file);
    if (!existing || entry.timestamp > existing.timestamp) {
      latestByFile.set(entry.file, entry);
    }
  }

  log(`Processing ${latestByFile.size} entries`);

  for (const [FILE, entry] of latestByFile) {
    log(`Processing entry: ${JSON.stringify(entry)}`);
    const { tool, errors: BASELINE } = entry;
    log(`  FILE=${FILE}, TOOL=${tool}, BASELINE=${JSON.stringify(BASELINE)}`);

    const fileExists = await Bun.file(FILE).exists();
    if (!fileExists) {
      log('  File does not exist, skipping');
      continue;
    }

    const proc = Bun.$`bunx ost-tools validate-file ${FILE} --json`.quiet().nothrow();
    const resultText = await proc.text();
    const result = resultText ? (JSON.parse(resultText) as ValidationResult) : {};
    log(`  FRESH_RESULT=${JSON.stringify(result)}`);

    const IN_SPACE = result.inSpace ?? false;

    if (IN_SPACE !== true) {
      log('  File not in space, skipping');
      continue;
    }

    const FRESH_ERRORS = result.errors ?? {};
    log(`  FRESH_ERRORS=${JSON.stringify(FRESH_ERRORS)}`);

    let newErrorsForFile: Record<string, ValidationError>;

    if (tool === 'Write') {
      // New file — all errors are new
      newErrorsForFile = FRESH_ERRORS;
      log('  New file: all errors are new');
    } else {
      // Edit — only errors absent from the baseline are new
      const baselineKeys = new Set(Object.keys(BASELINE ?? {}));
      const freshEntries = Object.entries(FRESH_ERRORS);
      newErrorsForFile = Object.fromEntries(freshEntries.filter(([key]) => !baselineKeys.has(key))) as Record<
        string,
        ValidationError
      >;
      log(`  Edit mode: computed NEW_ERRORS=${JSON.stringify(newErrorsForFile)}`);
    }

    const newCount = Object.keys(newErrorsForFile).length;
    log(`  NEW_COUNT=${newCount}`);

    if (newCount > 0) {
      const LABEL = result.label ?? FILE;
      const SPACE = result.space ?? 'unknown';
      log(`  New errors found in ${LABEL} (space: ${SPACE})`);

      const errorLines = Object.values(newErrorsForFile)
        .map((val) => `    [${val.kind}] ${val.message}`)
        .join('\n');

      newErrors.push(`  ${LABEL} (space: ${SPACE}) — ${newCount} new error(s):\n${errorLines}`);
      hasNewErrors = true;
      log('  Set HAS_NEW_ERRORS=1');
    } else {
      log('  No new errors for this file');
    }
  }

  // Clean up state file
  await Bun.$`rm -f ${STATE_FILE}`;
  log('Removed state file');

  if (hasNewErrors) {
    log('Exiting with code 2 (new errors found)');
    const errorMsg = `ost-tools: new validation errors introduced this session - use ost-tools skill to resolve:\n${newErrors.join('\n')}`;
    console.error(errorMsg);
    process.exit(2);
  }

  log('Exiting with code 0 (no new errors)');
}

main().catch((err) => {
  log(`Error: ${String(err)}`);
  console.error(err);
  process.exit(1);
});
