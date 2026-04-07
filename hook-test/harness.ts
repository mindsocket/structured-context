/**
 * E2E test harness: runs a Claude Code session via the Agent SDK with hooks
 * wired directly to the structured-context hook logic.
 *
 * All output (SDK messages, errors) is written to files in outputDir so tests
 * can inspect them after the run without relying on in-process buffering.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { runOnStop } from '../plugin/scripts/on-stop';
import { runPreEdit } from '../plugin/scripts/pre-edit';

const SCTX_BIN = join(import.meta.dir, '..', 'src', 'index.ts');

export interface RunClaudeOptions {
  /** Prompt to send to Claude */
  prompt: string;
  /** Isolated copy of fixtures — Claude's working directory */
  fixtureDir: string;
  /** Directory where all output files are written */
  outputDir: string;
  /** Absolute path to the isolated config.json */
  configPath: string;
}

export interface RunClaudeResult {
  /** 0 = no new errors, 2 = Stop hook detected new validation errors */
  exitCode: number;
  /** Actual session ID assigned by Claude (from the init message) */
  sessionId: string;
  outputDir: string;
  /** Directory where hook state files live during the session */
  stateDir: string;
  /**
   * State entries captured by the PreToolUse hook before the Stop hook deletes the file.
   * Each entry describes an Edit or Write operation on a .md file in a configured space.
   */
  stateEntries: object[];
  /** All SDK messages written as JSONL */
  messagesFile: string;
}

export async function runClaude(options: RunClaudeOptions): Promise<RunClaudeResult> {
  const { prompt, fixtureDir, outputDir, configPath } = options;

  const stateDir = join(outputDir, 'state');
  const messagesFile = join(outputDir, 'messages.jsonl');
  const errorsFile = join(outputDir, 'errors.txt');

  mkdirSync(outputDir, { recursive: true });

  const hookOpts = { stateDir, sctxBin: SCTX_BIN, configPath };
  let stopResult: { hasNewErrors: boolean; errorMessage?: string } = { hasNewErrors: false };
  let capturedStateEntries: object[] = [];
  let actualSessionId = 'unknown';
  const messages: object[] = [];

  try {
    const q = query({
      prompt,
      options: {
        cwd: fixtureDir,
        additionalDirectories: [fixtureDir],
        permissionMode: 'acceptEdits',
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                async (input) => {
                  await runPreEdit(
                    {
                      tool_name: (input as { tool_name?: string }).tool_name,
                      tool_input: (input as { tool_input?: { file_path?: string } }).tool_input,
                      session_id: input.session_id,
                    },
                    hookOpts,
                  );
                  return {};
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                async (input) => {
                  // Capture state entries before runOnStop deletes the state file
                  const stateFile = join(stateDir, `sctx-hook-${input.session_id}.jsonl`);
                  if (existsSync(stateFile)) {
                    capturedStateEntries = readFileSync(stateFile, 'utf-8')
                      .trim()
                      .split('\n')
                      .filter(Boolean)
                      .map((l) => JSON.parse(l));
                  }

                  stopResult = await runOnStop(
                    {
                      session_id: input.session_id,
                      stop_hook_active: (input as { stop_hook_active?: boolean }).stop_hook_active ?? false,
                    },
                    hookOpts,
                  );
                  // Always allow the stop — we report the result via exitCode
                  return {};
                },
              ],
            },
          ],
        },
      },
    });

    for await (const message of q) {
      messages.push(message);
      // Capture actual session ID from the init message
      if (
        actualSessionId === 'unknown' &&
        (message as { type?: string; subtype?: string }).type === 'system' &&
        (message as { type?: string; subtype?: string }).subtype === 'init'
      ) {
        actualSessionId = (message as { session_id?: string }).session_id ?? 'unknown';
      }
    }
  } catch (err) {
    writeFileSync(errorsFile, String(err));
  }

  writeFileSync(messagesFile, `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);

  const exitCode = stopResult.hasNewErrors ? 2 : 0;

  if (stopResult.hasNewErrors && stopResult.errorMessage) {
    writeFileSync(join(outputDir, 'stop-hook-errors.txt'), stopResult.errorMessage);
  }

  console.log(`[harness] output dir: ${outputDir}`);

  return {
    exitCode,
    sessionId: actualSessionId,
    outputDir,
    stateDir,
    stateEntries: capturedStateEntries,
    messagesFile,
  };
}
