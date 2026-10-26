/**
 * Failure handling shared by the hooks. A hook that crashes must not break the user's turn or print a
 * bare stack trace: it reports one short message per session and exits 0. Only a Stop hook that finds
 * genuine new validation errors blocks, and it does that itself.
 */

import { loadState, saveState, stateFilePath } from './state';

/** Print a user-visible warning for a hook (any event accepts `systemMessage`). */
export function warn(message: string): void {
  console.log(JSON.stringify({ systemMessage: message }));
}

/** Show `message` unless this code was already shown this session. */
export function warnOnce(sessionId: string | undefined, code: string, message: string): void {
  try {
    const file = stateFilePath(sessionId);
    const state = loadState(file);
    if (state.reported?.includes(code)) return;
    state.reported = [...(state.reported ?? []), code];
    saveState(file, state);
  } catch {
    // If the state can't be written, show the message anyway
  }
  warn(message);
}

/** Run a hook's main function so that an unexpected error becomes one message and exit code 0. */
export async function runSafely(
  name: string,
  sessionId: () => string | undefined,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    const detail = (err as Error).message?.split('\n')[0] ?? String(err);
    warnOnce(
      sessionId(),
      `E_HOOK_FAILED:${name}`,
      `structured-context: the ${name} hook failed (E_HOOK_FAILED): ${detail}. Validation for this step was skipped. ` +
        'The structured-context skill has troubleshooting steps; set SCTX_DEBUG=1 for details.',
    );
    if (process.env.SCTX_DEBUG) console.error(err);
  }
}
