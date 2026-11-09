import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';

import type { CwdContext, ModStatus } from '../types';

const STATUS: ModStatus = {
  report: {
    at: 1000,
    spaces: [
      {
        name: 'ost',
        path: '/vault/ost',
        errors: 1,
        warnings: 2,
        added: [{ file: 'Goal.md', severity: 'warning', message: 'missing summary' }],
        fixed: 1,
      },
    ],
  },
  spaces: [{ name: 'ost', errors: 1, warnings: 2 }],
};

const CWD: CwdContext = { spaces: ['ost'], digests: [{ space: 'ost', text: 'vision → mission → goal' }] };

const BAND = {
  plugin: 'structured-context',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const;

// Nothing sits beneath the plugin in a test: these hooks stand for the engine and for
// scripts/mod-bridge.ts, which the mod runs as a process.
function engine(on: On, submitted: string[] = []) {
  on('session.id', () => ({ value: 'session-1' }));
  on('tool.register', (_, e) => ({ value: { tool: `mcp__structured-context__${e.name}` } }));
  on('ui.status', () => ({ value: undefined }));
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('classic.Stop', () => ({}));
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box />;
  });
  on('turn.complete', () => ({ text: 'Done.' }));
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }));
  on('prompt.submit', (_, e) => {
    submitted.push(e.text);
    return { text: e.text };
  });
  on('process.run', (_, e) => {
    const [command] = e.argv.slice(3);
    const stdout =
      command === 'status' ? JSON.stringify(STATUS) : command === 'digest' ? JSON.stringify(CWD) : '{"valid":true}';
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
  });
  return submitted;
}

const stop = { stop_hook_active: false, last_assistant_message: '' };

test('a turn that changed issues gets a line under the answer, once', async ($, on) => {
  engine(on);
  await $.classic.Stop(stop);

  const first = await $.turn.complete({
    answer: 'Done.',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  });
  expect(first.text).toBe('structured-context · ost: 1 new, 1 fixed (now 1 errors, 2 warnings)');

  const second = await $.turn.complete({
    answer: 'Done.',
    durationMs: 1,
    isAborted: false,
    turnId: 't2',
    reason: 'answer',
  });
  expect(second.text).toBe('Done.');
});

test('the band lists new issues and asks Claude to fix them', async ($, on) => {
  const submitted = engine(on);
  await $.classic.Stop(stop);

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface });
    expect((await ui.find({ type: 'Text', text: /missing summary/ }))?.text).toContain('Goal.md');
    await ui.unmount();
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });
  await ui.press({ key: 'fix' });
  expect(submitted[0]).toContain('- ost/Goal.md (warning): missing summary');
  expect(await ui.find({ type: 'Text', text: /missing summary/ })).toBeUndefined();
  await ui.unmount();
});

test('the system prompt carries the schema of the spaces in the directory', async ($, on) => {
  engine(on);
  await $.session.start({ cwd: '/vault', surface: 'terminal', isInteractive: true });

  const { sections } = await $.prompt.compose({
    model: 'm',
    promptModel: 'm',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  });
  const added = sections.find((section) => section.id === 'structured-context:schema');
  expect(added?.text).toContain('### Space `ost`');
  expect(added?.text).toContain('vision → mission → goal');
});

test('the validate tool answers with the CLI output', async ($, on) => {
  engine(on);
  const ran = await $.tool.call({ tool: 'mcp__structured-context__validate', space: 'ost' });
  expect(ran.result).toBe('{"valid":true}');

  const refused = await $.tool.call({ tool: 'mcp__structured-context__validate' });
  expect(refused.deny).toBe('Give a space name or a file path.');
});
