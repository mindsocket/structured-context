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
  /** Present when new warnings were introduced. Reported to Claude without blocking as an error. */
  warningMessage?: string;
}

interface HookState {
  session_id: string;
  timestamp: number;
  tool: 'Write' | 'Edit';
  file: string;
  errors: object | null;
  /** Absent in state written by older versions of the pre-edit hook */
  warnings?: object | null;
}

interface ValidationIssue {
  kind: string;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

interface ValidationResult {
  inSpace?: boolean;
  label?: string;
  space?: string;
  errors?: Record<string, ValidationIssue>;
  warnings?: Record<string, ValidationIssue>;
}

/** Issues in `fresh` that are not in the baseline. A Write has no baseline, so every issue is new. */
function newIssues(
  tool: HookState['tool'],
  fresh: Record<string, ValidationIssue>,
  baseline: object | null | undefined,
): ValidationIssue[] {
  const baselineKeys = tool === 'Write' ? new Set<string>() : new Set(Object.keys(baseline ?? {}));
  return Object.entries(fresh)
    .filter(([key]) => !baselineKeys.has(key))
    .map(([, issue]) => issue);
}

function formatIssues(header: string, issues: ValidationIssue[], noun: string): string {
  const lines = issues.map((issue) => `    [${issue.kind}] ${issue.message}`).join('\n');
  return `  ${header} — ${issues.length} new ${noun}(s):\n${lines}`;
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
  const newWarnings: string[] = [];

  // Read all entries and keep the earliest per file (by timestamp): its baseline is the file's
  // state before this session's first change, so later edits can't absorb issues earlier ones introduced
  const lines = (await stateFile.text())
    .trim()
    .split('\n')
    .filter((l) => l);
  const entries: HookState[] = lines.map((l) => JSON.parse(l));

  const earliestByFile = new Map<string, HookState>();
  for (const entry of entries) {
    const existing = earliestByFile.get(entry.file);
    if (!existing || entry.timestamp < existing.timestamp) {
      earliestByFile.set(entry.file, entry);
    }
  }

  const BIN = options?.sctxBin ?? process.env.SCTX_BIN;
  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.configPath) {
    env.SCTX_CONFIG = options.configPath;
  }

  for (const [FILE, entry] of earliestByFile) {
    const { tool } = entry;

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

    const HEADER = `${result.label ?? FILE} (space: ${result.space ?? 'unknown'})`;

    const fileErrors = newIssues(tool, result.errors ?? {}, entry.errors);
    if (fileErrors.length > 0) {
      newErrors.push(formatIssues(HEADER, fileErrors, 'error'));
    }

    // Info-level rule violations are not worth another turn from Claude
    const fileWarnings = newIssues(tool, result.warnings ?? {}, entry.warnings).filter(
      (issue) => issue.severity !== 'info',
    );
    if (fileWarnings.length > 0) {
      newWarnings.push(formatIssues(HEADER, fileWarnings, 'warning'));
    }
  }

  // Clean up state file
  await Bun.$`rm -f ${STATE_FILE}`;

  const warningMessage =
    newWarnings.length > 0
      ? `structured-context: new validation warnings introduced this session - fix them with the structured-context skill if appropriate, otherwise mention them to the user:\n${newWarnings.join('\n')}`
      : undefined;

  if (newErrors.length > 0) {
    const errorMessage = `structured-context: new validation errors introduced this session - use structured-context skill to resolve:\n${newErrors.join('\n')}`;
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
