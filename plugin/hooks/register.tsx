// The structured-context mod: shows what the validation hooks found, beside the chat.
//
// The command hooks in hooks.json still baseline and gate each turn. This module adds to them:
// after the prompt and Stop hooks run it reads their state (scripts/mod-bridge.ts) and draws it,
// adds the schema of the session's spaces to the system prompt, and gives the model sctx tools.
// It never validates on a tool call: a space can be invalid partway through a multi-file change.

import type { EngineInterface, Register } from 'claude-code';
import { atom, read, update } from 'claude-code';

import type { CwdContext, ModStatus, SpaceReport } from '../types';

const status = atom({ plugin: 'structured-context', key: 'status' } as const, null, { shape: 'status-1' });
const cwd = atom(
  { plugin: 'structured-context', key: 'cwd' } as const,
  { spaces: [], digests: [] },
  { shape: 'cwd-1' },
);
const dismissedAt = atom({ plugin: 'structured-context', key: 'dismissedAt' } as const, 0);
const summarisedAt = atom({ plugin: 'structured-context', key: 'summarisedAt' } as const, 0);
const isDigestStale = atom({ plugin: 'structured-context', key: 'isDigestStale' } as const, false);

const SCHEMA_FILE = /\.json5?$/;
// The system prompt carries this much schema text at most, across all spaces
const DIGEST_LIMIT = 8000;
const BAND_ISSUES = 3;

async function bridge($: EngineInterface, args: string[]): Promise<string | undefined> {
  const run = await $.process.run(['bun', 'run', `${$.plugin.root}/scripts/mod-bridge.ts`, ...args], {
    timeoutMs: 120_000,
  });
  return run.exitCode === 0 ? run.stdout : undefined;
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const text = await bridge($, ['status', await $.session.id()]);
  if (!text) return;
  const next = JSON.parse(text) as ModStatus;
  await update($, status, () => next);
  // `next.spaces` holds every space the session baselined, including ones edited outside the directory
  const { spaces: here } = await read($, cwd);
  const shown = next.spaces.filter((space) => here.includes(space.name));
  $.ui.status(shown.length > 0 ? shown.map(countsLine).join(' · ') : undefined);
}

async function refreshCwd($: EngineInterface): Promise<void> {
  const text = await bridge($, ['digest']);
  if (!text) return;
  const next = JSON.parse(text) as CwdContext;
  await update($, cwd, () => next);
  await update($, isDigestStale, () => false);
}

function countsLine(space: { name: string; errors: number; warnings: number }): string {
  const counts = [
    ...(space.errors > 0 ? [`❌ ${space.errors}`] : []),
    ...(space.warnings > 0 ? [`⚠️ ${space.warnings}`] : []),
  ];
  return `${space.name} ${counts.length > 0 ? counts.join(' ') : '✓'}`;
}

function changeLine(space: SpaceReport): string {
  const parts = [`${space.added.length} new`, ...(space.fixed > 0 ? [`${space.fixed} fixed`] : [])];
  return `${space.name}: ${parts.join(', ')} (now ${space.errors} errors, ${space.warnings} warnings)`;
}

const hasChanges = (space: SpaceReport) => space.added.length > 0 || space.fixed > 0;

function fixPrompt(spaces: SpaceReport[]): string {
  const lines = spaces.flatMap((space) =>
    space.added.map(
      (issue) => `- ${space.name}${issue.file ? `/${issue.file}` : ''} (${issue.severity}): ${issue.message}`,
    ),
  );
  return `Fix these structured-context issues from the last turn, using the structured-context skill:\n${lines.join('\n')}`;
}

const TOOLS = [
  {
    name: 'spaces',
    description:
      'List the structured-context (sctx) spaces in the config the session finds: name, path, schema, and config problems. JSON.',
    argv: () => ['spaces', '--json'],
  },
  {
    name: 'validate',
    description:
      'Validate a structured-context space by name, or one markdown file within its space by path. JSON with errors, rule violations and parse issues.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string', description: 'Space name, from the spaces tool' },
        file: { type: 'string', description: 'Absolute path of one file to validate instead of a whole space' },
      },
    },
    argv: (e: { space?: string; file?: string }) =>
      e.file ? ['validate-file', e.file, '--json'] : ['validate', e.space ?? '', '--json'],
  },
  {
    name: 'schema',
    description:
      "Show a structured-context space's schema: entity types, fields (required marked *), hierarchy, relationships and rules.",
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string', description: 'Space name, from the spaces tool' } },
      required: ['space'],
    },
    argv: (e: { space?: string }) => ['schemas', 'show', '--space', e.space ?? ''],
  },
] as const;

// Hooks that only observe end in .catch((_, e, next) => next(e)): if one fails, the event goes on
// as the hooks beneath settle it (a call already made is replayed, not run twice).
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await Promise.all(
      TOOLS.map(({ name, description, ...rest }) =>
        $.tool.register({ name, description, ...('inputSchema' in rest ? { inputSchema: rest.inputSchema } : {}) }),
      ),
    );
    await refreshCwd($);
    await refreshStatus($);
    return next(e);
  });

  for (const tool of TOOLS) {
    on('tool.call', { tool: `mcp__structured-context__${tool.name}` }, async ($, e) => {
      const input = e as unknown as { space?: string; file?: string };
      if (tool.name === 'validate' && !input.space && !input.file) {
        return { deny: 'Give a space name or a file path.' };
      }
      const run = await $.process.run(
        ['bun', 'run', `${$.plugin.root}/scripts/mod-bridge.ts`, 'sctx', ...tool.argv(input)],
        { timeoutMs: 120_000 },
      );
      // validate exits 1 when it finds errors; its JSON is still the answer
      const text = run.stdout.trim() || run.stderr.trim() || `sctx exited with code ${run.exitCode}`;
      return { result: text };
    }).catch(() => ({ deny: `structured-context: the ${tool.name} tool failed to run sctx.` }));
  }

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (SCHEMA_FILE.test(e.file_path)) await update($, isDigestStale, () => true);
    return next(e);
  }).catch((_, e, next) => next(e));

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (SCHEMA_FILE.test(e.file_path)) await update($, isDigestStale, () => true);
    return next(e);
  }).catch((_, e, next) => next(e));

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e);
    await refreshStatus($);
    return result;
  }).catch((_, e, next) => next(e));

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e);
    if (await read($, isDigestStale)) await refreshCwd($);
    await refreshStatus($);
    return result;
  }).catch((_, e, next) => next(e));

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId !== undefined) return result;
    const report = (await read($, status))?.report;
    if (!report || report.at <= (await read($, summarisedAt))) return result;
    await update($, summarisedAt, () => report.at);
    const changed = report.spaces.filter(hasChanges);
    if (changed.length === 0) return result;
    return { ...result, text: `structured-context · ${changed.map(changeLine).join(' · ')}` };
  });

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e);
    const { digests } = await read($, cwd);
    if (digests.length === 0) return result;
    const body = digests.map(({ space, text }) => `### Space \`${space}\`\n\n${text}`).join('\n\n');
    const text =
      'structured-context spaces in this directory, with their schemas (from `sctx schemas show`). ' +
      'Notes written in a space must follow its schema; the validation hooks check them when the turn ends.\n\n' +
      body.slice(0, DIGEST_LIMIT);
    return { sections: [...result.sections, { id: 'structured-context:schema', text, scope: 'session' }] };
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const report = (await read($, status))?.report;
    if (!report || report.at <= (await read($, dismissedAt))) return next(e);
    const changed = report.spaces.filter((space) => space.added.length > 0);
    if (changed.length === 0) return next(e);

    const { Box, Button, Text } = $.ui.resolve(e);
    const issues = changed.flatMap((space) => space.added.map((issue) => ({ space: space.name, ...issue })));
    return (
      <Box flexDirection="column">
        {changed.map((space) => (
          <Text>structured-context · {changeLine(space)}</Text>
        ))}
        {issues.slice(0, BAND_ISSUES).map((issue) => (
          <Text dimColor>
            {'  '}
            {issue.severity} {issue.file || issue.space}: {issue.message}
          </Text>
        ))}
        {issues.length > BAND_ISSUES && <Text dimColor>{`  and ${issues.length - BAND_ISSUES} more`}</Text>}
        <Box gap={1}>
          <Button
            key="fix"
            label="Ask Claude to fix"
            variant="primary"
            onPress={async () => {
              await update($, dismissedAt, () => report.at);
              await $.prompt.submit({ text: fixPrompt(changed) });
            }}
          />
          <Button key="dismiss" label="Dismiss" onPress={() => update($, dismissedAt, () => report.at)} />
        </Box>
      </Box>
    );
  });
};
