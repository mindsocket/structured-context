import type { On } from 'claude-code';
import { type Engine, expect, test } from 'claude-code/testing';

import type { CwdContext, ModStatus, PaneData } from '../types';
import { fit } from './map-pane';

const level = (type: string) => ({ type, field: 'parent', fieldOn: 'child', multiple: false, selfRef: false });
const node = (id: string, type: string, parent?: string) => ({
  id,
  title: id.replace(/\.md$/, ''),
  schemaData: {},
  linkTargets: [id.replace(/\.md$/, '')],
  type,
  resolvedType: type,
  resolvedParents: parent
    ? [{ id: parent, field: 'parent', kind: 'hierarchy', hierarchy: 'main', selfRef: false, fieldOn: 'child' }]
    : [],
  resolvedLinks: [],
  source: { file: id },
});

const DATA: PaneData = {
  space: 'ost',
  path: '/vault/ost',
  graph: {
    formatVersion: 1,
    mainHierarchy: 'main',
    hierarchies: [
      { name: 'main', levels: [level('goal'), level('opportunity')] },
      { name: 'flat', levels: [level('opportunity')] },
    ],
    nodes: [
      node('Goal.md', 'goal'),
      node('Opp A.md', 'opportunity', 'Goal.md'),
      node('Opp B.md', 'opportunity', 'Goal.md'),
    ],
  },
  validation: {
    issues: {
      'Broken.md': { 'schema:type': { kind: 'schema', message: 'type is not allowed', severity: 'error' } },
      'Opp A.md': { 'rule:summary': { kind: 'rule', message: '[summary] missing summary', severity: 'warning' } },
    },
    // Rule results on a node are in `issues`; `ruleViolations` adds only those without one
    ruleViolations: [],
    parseIssues: [{ file: 'Bad.md', severity: 'error', type: 'yaml', message: 'bad frontmatter' }],
  },
};

const statusAt = (at: number): ModStatus => ({
  report: { at, spaces: [{ name: 'ost', path: '/vault/ost', errors: 1, warnings: 1, added: [], fixed: 0 }] },
  spaces: [{ name: 'ost', errors: 1, warnings: 1 }],
});
const CWD: CwdContext = { spaces: ['ost', 'other'], digests: [] };

const PANE = {
  plugin: 'structured-context',
  component: 'Pane',
  requestId: 'structured-context-map',
  props: {
    title: 'Space map',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

// Stands for the engine and for scripts/mod-bridge.ts; returns the bridge commands run
function engine(
  on: On,
  submitted: { text: string; context?: readonly string[] }[] = [],
  // A space whose pane load waits for this
  hold?: { space: string; until: Promise<void> },
) {
  const bridge: string[][] = [];
  // Each Stop the hooks run makes a newer report
  let reportAt = 1000;
  on('session.id', () => ({ value: 'session-1' }));
  on('tool.register', (_, e) => ({ value: { tool: `mcp__structured-context__${e.name}` } }));
  on('command.register', (_, e) => ({ value: { command: e.name } }));
  on('ui.status', () => ({ value: undefined }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.panes', () => ({
    value: [{ id: 'structured-context-map', title: 'Space map', isShown: true, isFocused: false, isPlaced: true }],
  }));
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('classic.Stop', () => {
    reportAt += 1000;
    return {};
  });
  on('classic.UserPromptSubmit', () => ({}));
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, context: e.context });
    return { text: e.text };
  });
  on('process.run', async (_, e) => {
    const args = e.argv.slice(3);
    if (hold && args[0] === 'pane' && args[2] === hold.space) await hold.until;
    bridge.push(args);
    const [command] = args;
    const stdout =
      command === 'status'
        ? JSON.stringify(statusAt(reportAt))
        : command === 'digest'
          ? JSON.stringify(CWD)
          : command === 'pane'
            ? JSON.stringify(DATA)
            : '';
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
  });
  return bridge;
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } as const });

async function opened($: Engine) {
  await $.session.start({ cwd: '/vault', surface: 'terminal', isInteractive: true });
  await $.command.run({
    command: 'sctx-map',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  });
}

test('the pane draws the hierarchy with each node’s results, on every surface', async ($, on) => {
  const bridge = engine(on);
  await opened($);
  expect(bridge.some(([command, , space]) => command === 'pane' && space === 'ost')).toBe(true);

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: 'Text', text: /2 errors, 1 warnings/ })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Opp A' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /● 1/ })).toBeDefined();
    // A node that failed its schema isn't on the tree, so it is listed under it
    expect((await ui.find({ type: 'Text', text: /type is not allowed/ }))?.text).toContain('Broken.md');
    expect((await ui.find({ type: 'Text', text: /bad frontmatter/ }))?.text).toContain('Bad.md');
    await ui.unmount();
  }
});

test('collapsing a row hides its children', async ($, on) => {
  engine(on);
  await opened($);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  await ui.press({ key: 'toggle:["pane","Goal.md"]' });
  expect(await ui.find({ type: 'Button', text: 'Opp A' })).toBeUndefined();
  expect(await ui.find({ type: 'Text', text: /goal \+2/ })).toBeDefined();
  await ui.unmount();
});

test('another hierarchy lays the space out again', async ($, on) => {
  engine(on);
  await opened($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.select({ key: 'hierarchy', value: 'flat' });
  expect(await ui.find({ type: 'Button', text: 'Goal' })).toBeUndefined();
  expect(await ui.find({ type: 'Button', text: 'Opp B' })).toBeDefined();
  await ui.unmount();
});

test('a focused node goes with each prompt until it is unfocused', async ($, on) => {
  const submitted: { text: string; context?: readonly string[] }[] = [];
  engine(on, submitted);
  await opened($);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  await ui.press({ key: 'select:["pane","Goal.md","Opp A.md"]' });
  expect((await ui.find({ type: 'Text', text: /missing summary/ }))?.text).toBe('warning: [summary] missing summary');
  await ui.press({ key: 'focus' });

  await $.prompt.submit(typed('tighten this node'));
  expect(submitted[0]?.context?.[0]).toContain('"Opp A" (opportunity) in space `ost`, in /vault/ost/Opp A.md');
  expect(submitted[0]?.context?.[0]).toContain('- warning: [summary] missing summary');

  await ui.press({ key: 'unfocus' });
  await $.prompt.submit(typed('and now?'));
  expect(submitted[1]?.context).toBeUndefined();
  await ui.unmount();
});

test('a Stop that validated the pane’s space reloads it', async ($, on) => {
  const bridge = engine(on);
  await opened($);
  const loads = () => bridge.filter(([command]) => command === 'pane').length;
  const before = loads();
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '' });
  expect(loads()).toBe(before + 1);
  // A prompt refreshes the status but makes no new report
  await $.classic.UserPromptSubmit({ prompt: 'hi' });
  expect(loads()).toBe(before + 1);
});

test('switching space hides the old tree until the new one loads', async ($, on) => {
  let release = () => {};
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  engine(on, [], { space: 'other', until });
  await opened($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const picking = ui.select({ key: 'space', value: 'other' });
  expect(await ui.find({ type: 'Text', text: 'Loading…' })).toBeDefined();
  expect(await ui.find({ type: 'Button', text: 'Opp A' })).toBeUndefined();
  release();
  await picking;
  expect(await ui.find({ type: 'Text', text: 'Loading…' })).toBeUndefined();
  expect(await ui.find({ type: 'Button', text: 'Opp A' })).toBeDefined();
  await ui.unmount();
});

test('a long title is cut to fit the pane, so its row stays one line', async ($, on) => {
  expect(fit('SafetyCulture - 2nd interview - 1st formal round', 20)).toBe('SafetyCulture - 2nd…');
  expect(fit('Goal', 20)).toBe('Goal');
  // However deep the row, a title keeps a readable stub
  expect(fit('SafetyCulture - 2nd interview', -5)).toBe('SafetyCultu…');

  engine(on);
  await opened($);
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 30 }, surface: 'terminal' });
  expect(await ui.find({ type: 'Button', text: 'Opp A' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'opportunity' })).toBeDefined();
  await ui.unmount();
});
