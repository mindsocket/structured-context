#!/usr/bin/env bun

export interface OnStopInput {
  session_id?: string;
  stop_hook_active?: boolean;
}

export interface OnStopOptions {
  /** Overrides SCTX_STATE_DIR env var */
  stateDir?: string;
  /** Path to structured-context entry point. When set, uses `bun run <path>` instead of `bunx structured-context`. */
  sctxBin?: string;
  /** Path to config file. When set, passed as SCTX_CONFIG to validate-file subprocess. */
  configPath?: string;
}

export interface OnStopResult {
  hasNewErrors: boolean;
  /** Present when hasNewErrors is true */
  errorMessage?: string;
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

export async function runOnStop(input: OnStopInput, options?: OnStopOptions): Promise<OnStopResult> {
  const SESSION_ID = input.session_id ?? 'unknown';
  const STOP_HOOK_ACTIVE = input.stop_hook_active ?? false;

  // Guard against infinite loop: stop hooks can trigger another stop cycle
  if (STOP_HOOK_ACTIVE === true) {
    return { hasNewErrors: false };
  }

  const STATE_DIR = options?.stateDir ?? process.env.SCTX_STATE_DIR ?? '/tmp';
  const STATE_FILE = `${STATE_DIR}/sctx-hook-${SESSION_ID}.jsonl`;

  const stateFile = Bun.file(STATE_FILE);
  const stateFileExists = await stateFile.exists();
  if (!stateFileExists) {
    return { hasNewErrors: false };
  }

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

  const BIN = options?.sctxBin ?? process.env.SCTX_BIN;
  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.configPath) {
    env.SCTX_CONFIG = options.configPath;
  }

  for (const [FILE, entry] of latestByFile) {
    const { tool, errors: BASELINE } = entry;

    const fileExists = await Bun.file(FILE).exists();
    if (!fileExists) {
      continue;
    }

    const proc = BIN
      ? Bun.$`bun run ${[BIN]} validate-file ${[FILE]} --json`.env(env).quiet().nothrow()
      : Bun.$`bunx structured-context validate-file ${[FILE]} --json`.env(env).quiet().nothrow();
    const resultText = await proc.text();
    const result = resultText ? (JSON.parse(resultText) as ValidationResult) : {};

    const IN_SPACE = result.inSpace ?? false;
    if (IN_SPACE !== true) {
      continue;
    }

    const FRESH_ERRORS = result.errors ?? {};

    let newErrorsForFile: Record<string, ValidationError>;

    if (tool === 'Write') {
      // New file — all errors are new
      newErrorsForFile = FRESH_ERRORS;
    } else {
      // Edit — only errors absent from the baseline are new
      const baselineKeys = new Set(Object.keys(BASELINE ?? {}));
      const freshEntries = Object.entries(FRESH_ERRORS);
      newErrorsForFile = Object.fromEntries(freshEntries.filter(([key]) => !baselineKeys.has(key))) as Record<
        string,
        ValidationError
      >;
    }

    const newCount = Object.keys(newErrorsForFile).length;

    if (newCount > 0) {
      const LABEL = result.label ?? FILE;
      const SPACE = result.space ?? 'unknown';

      const errorLines = Object.values(newErrorsForFile)
        .map((val) => `    [${val.kind}] ${val.message}`)
        .join('\n');

      newErrors.push(`  ${LABEL} (space: ${SPACE}) — ${newCount} new error(s):\n${errorLines}`);
      hasNewErrors = true;
    }
  }

  // Clean up state file
  await Bun.$`rm -f ${STATE_FILE}`;

  if (hasNewErrors) {
    const errorMessage = `structured-context: new validation errors introduced this session - use structured-context skill to resolve:\n${newErrors.join('\n')}`;
    return { hasNewErrors: true, errorMessage };
  }

  return { hasNewErrors: false };
}

async function main() {
  const INPUT_TEXT = await Bun.stdin.text();
  const INPUT = JSON.parse(INPUT_TEXT) as OnStopInput;
  const result = await runOnStop(INPUT);

  if (result.hasNewErrors) {
    console.error(result.errorMessage);
    process.exit(2);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
