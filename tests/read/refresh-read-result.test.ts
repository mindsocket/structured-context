import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { readSpace, refreshReadResult } from '../../src/read/read-space';
import { createSpaceContext } from '../../src/space-context';
import { validateSpace } from '../../src/validate';

const tempDirs: string[] = [];

function makeTempSpace(
  files: Record<string, string>,
  options: {
    schema?: string;
    plugins?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'sctx-refresh-'));
  tempDirs.push(root);
  const spaceDir = join(root, 'space');
  mkdirSync(spaceDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(spaceDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  const config: Config = {
    spaces: [
      {
        name: 'test',
        path: spaceDir,
        schema: options.schema ?? 'strategy_general.json',
        ...(options.plugins ? { plugins: options.plugins } : {}),
      },
    ],
  };
  const context = createSpaceContext('test', config, { configDir: root });
  return { root, spaceDir, context };
}

function sortByKey<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

/** Compare the full read and validation results of a refreshed read against a fresh full read, ignoring order. */
async function expectMatchesFullRead(
  context: ReturnType<typeof createSpaceContext>,
  refreshed: Awaited<ReturnType<typeof refreshReadResult>>,
) {
  const full = await readSpace(context);
  const refreshedVal = await validateSpace(context, { readResult: refreshed });
  const fullVal = await validateSpace(context, { readResult: full });

  const nodeSummary = (n: (typeof full.nodes)[number]) => ({
    id: n.id,
    title: n.title,
    resolvedType: n.resolvedType,
    resolvedParents: sortByKey(n.resolvedParents, (p) => `${p.kind}:${p.hierarchy ?? ''}:${p.field}:${p.id}`),
    resolvedLinks: sortByKey(n.resolvedLinks, (l) => `${l.location}:${l.action}:${l.target}:${l.anchor ?? ''}`),
  });

  expect(sortByKey(refreshed.nodes.map(nodeSummary), (n) => n.id)).toEqual(
    sortByKey(full.nodes.map(nodeSummary), (n) => n.id),
  );
  expect(sortByKey(refreshed.parseIssues, (i) => `${i.source.file}:${i.type}:${i.severity}`)).toEqual(
    sortByKey(full.parseIssues, (i) => `${i.source.file}:${i.type}:${i.severity}`),
  );
  expect(sortByKey(refreshed.unresolvedRefs, (r) => `${r.id}:${r.field}:${r.ref}`)).toEqual(
    sortByKey(full.unresolvedRefs, (r) => `${r.id}:${r.field}:${r.ref}`),
  );
  expect(sortByKey(refreshed.unresolvedContentLinks, (l) => `${l.nodeId}:${l.target}`)).toEqual(
    sortByKey(full.unresolvedContentLinks, (l) => `${l.nodeId}:${l.target}`),
  );
  expect(refreshedVal.validCount).toBe(fullVal.validCount);
  expect(sortByKey(refreshedVal.orphans, (o) => o.nodeId)).toEqual(sortByKey(fullVal.orphans, (o) => o.nodeId));
  expect(sortByKey(refreshedVal.issues, (i) => `${i.kind}:${i.nodeId ?? ''}:${i.source?.file ?? ''}:${i.key}`)).toEqual(
    sortByKey(fullVal.issues, (i) => `${i.kind}:${i.nodeId ?? ''}:${i.source?.file ?? ''}:${i.key}`),
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('refreshReadResult', () => {
  test('returns previous result unchanged when changedFiles is empty', async () => {
    const { context } = makeTempSpace({
      'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\n',
    });
    const initial = await readSpace(context);
    const refreshed = await refreshReadResult(context, initial, []);
    expect(refreshed).toBe(initial);
  });

  test('matches full read after modifying a file and its embedded nodes', async () => {
    const { spaceDir, context } = makeTempSpace({
      'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\n',
      'goal.md':
        '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Our Vision]]"\n---\n\n## Opp 1 [type:: opportunity]\nstatus:: active\n',
    });
    const initial = await readSpace(context);

    writeFileSync(
      join(spaceDir, 'goal.md'),
      '---\ntype: goal\ntitle: Goal A Renamed\nstatus: exploring\nparent: "[[Our Vision]]"\n---\n\n## Opp 2 [type:: opportunity]\nstatus:: active\n',
    );
    const refreshed = await refreshReadResult(context, initial, ['goal.md']);
    await expectMatchesFullRead(context, refreshed);
    expect(refreshed.nodes.some((n) => n.title === 'Goal A Renamed')).toBe(true);
    expect(refreshed.nodes.some((n) => n.title === 'Opp 1')).toBe(false);
    expect(refreshed.nodes.some((n) => n.title === 'Opp 2')).toBe(true);
  });

  test('handles created, deleted and renamed files and re-resolves graph edges', async () => {
    const { spaceDir, context } = makeTempSpace({
      'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\n',
      'goal.md': '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Missing Vision]]"\n---\n',
    });
    let state = await readSpace(context);
    expect(state.unresolvedRefs).toHaveLength(1);

    // Create the missing target file
    writeFileSync(join(spaceDir, 'missing.md'), '---\ntype: vision\ntitle: Missing Vision\nstatus: active\n---\n');
    state = await refreshReadResult(context, state, ['missing.md']);
    expect(state.unresolvedRefs).toHaveLength(0);
    await expectMatchesFullRead(context, state);

    // Rename missing.md -> renamed.md
    renameSync(join(spaceDir, 'missing.md'), join(spaceDir, 'renamed.md'));
    state = await refreshReadResult(context, state, ['missing.md', 'renamed.md']);
    expect(state.nodes.some((n) => n.id === 'renamed.md')).toBe(true);
    expect(state.nodes.some((n) => n.id === 'missing.md')).toBe(false);
    await expectMatchesFullRead(context, state);

    // Delete renamed.md -> link becomes broken again
    unlinkSync(join(spaceDir, 'renamed.md'));
    state = await refreshReadResult(context, state, ['renamed.md']);
    expect(state.unresolvedRefs).toHaveLength(1);
    await expectMatchesFullRead(context, state);
  });

  test('handles a typed page becoming untyped and preserves excludedPages for content links', async () => {
    const { spaceDir, context } = makeTempSpace({
      'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\nSee [[notes]] for background.\n',
      'notes.md': '---\ntype: goal\ntitle: Notes\nstatus: active\nparent: "[[Our Vision]]"\n---\n',
    });
    let state = await readSpace(context);

    // Make notes.md untyped -> becomes a parseIssue + excludedPage, so [[notes]] still resolves as excluded
    writeFileSync(join(spaceDir, 'notes.md'), '# Just plain notes\n');
    state = await refreshReadResult(context, state, ['notes.md']);
    expect(state.parseIssues.some((i) => i.source.file === 'notes.md' && i.type === 'no-type')).toBe(true);
    expect(state.unresolvedContentLinks).toEqual([]);
    await expectMatchesFullRead(context, state);

    // Make notes.md typed again -> parseIssue disappears
    writeFileSync(
      join(spaceDir, 'notes.md'),
      '---\ntype: goal\ntitle: Notes\nstatus: active\nparent: "[[Our Vision]]"\n---\n',
    );
    state = await refreshReadResult(context, state, ['notes.md']);
    expect(state.parseIssues).toEqual([]);
    await expectMatchesFullRead(context, state);
  });

  test('re-resolves ambiguous wikilinks in untouched files when a duplicate basename is added or removed', async () => {
    const { spaceDir, context } = makeTempSpace({
      'a/Shared.md': '---\ntype: vision\nstatus: active\n---\n',
      'goal.md': '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Shared]]"\n---\n',
    });
    let state = await readSpace(context);
    expect(state.unresolvedRefs).toEqual([]);

    // Adding b/Shared.md makes [[Shared]] in untouched goal.md ambiguous
    mkdirSync(join(spaceDir, 'b'), { recursive: true });
    writeFileSync(join(spaceDir, 'b/Shared.md'), '---\ntype: vision\nstatus: active\n---\n');
    state = await refreshReadResult(context, state, ['b/Shared.md']);
    expect(state.unresolvedRefs).toHaveLength(1);
    expect(state.unresolvedRefs[0]?.reason).toBe('ambiguous');
    await expectMatchesFullRead(context, state);

    // Deleting b/Shared.md resolves the ambiguity in untouched goal.md
    unlinkSync(join(spaceDir, 'b/Shared.md'));
    state = await refreshReadResult(context, state, ['b/Shared.md']);
    expect(state.unresolvedRefs).toEqual([]);
    await expectMatchesFullRead(context, state);
  });

  test('handles YAML parse errors and recovery without leaking stale nodes', async () => {
    const { spaceDir, context } = makeTempSpace({
      'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\nSee [[goal]].\n',
      'goal.md': '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Our Vision]]"\n---\n',
    });
    let state = await readSpace(context);

    writeFileSync(join(spaceDir, 'goal.md'), '---\ntype: [unterminated\n---\n');
    state = await refreshReadResult(context, state, ['goal.md']);
    expect(state.parseIssues.some((i) => i.source.file === 'goal.md' && i.type === 'parse')).toBe(true);
    expect(state.nodes.some((n) => n.id === 'goal.md')).toBe(false);
    await expectMatchesFullRead(context, state);

    writeFileSync(
      join(spaceDir, 'goal.md'),
      '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Our Vision]]"\n---\n',
    );
    state = await refreshReadResult(context, state, ['goal.md']);
    expect(state.parseIssues).toEqual([]);
    expect(state.nodes.some((n) => n.id === 'goal.md')).toBe(true);
    await expectMatchesFullRead(context, state);
  });

  test('propagates cascade gating to untouched descendants when an ancestor changes', async () => {
    const { spaceDir, context } = makeTempSpace({
      'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\n',
      'goal.md': '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Our Vision]]"\n---\n',
    });
    let state = await readSpace(context);

    // Introduce a schema error on vision.md -> untouched goal.md becomes gated
    writeFileSync(join(spaceDir, 'vision.md'), '---\ntype: vision\ntitle: Our Vision\nstatus: bogus\n---\n');
    state = await refreshReadResult(context, state, ['vision.md']);
    const val = await validateSpace(context, { readResult: state });
    expect(val.issues.some((i) => i.kind === 'gated' && i.nodeId === 'goal.md')).toBe(true);
    await expectMatchesFullRead(context, state);
  });

  test('ignores templateDir files, non-markdown files and paths outside the space root', async () => {
    const { root, spaceDir, context } = makeTempSpace(
      {
        'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\n',
      },
      {
        plugins: { 'sctx-markdown': { templateDir: join('space', 'templates') } },
      },
    );
    let state = await readSpace(context);

    mkdirSync(join(spaceDir, 'templates'), { recursive: true });
    writeFileSync(join(spaceDir, 'templates/goal.md'), '---\ntype: goal\ntitle: Template\nstatus: active\n---\n');
    writeFileSync(join(spaceDir, 'diagram.png'), 'not-markdown');
    writeFileSync(join(root, 'outside.md'), '---\ntype: vision\ntitle: Outside\nstatus: active\n---\n');

    state = await refreshReadResult(context, state, ['templates/goal.md', 'diagram.png', '../outside.md']);
    expect(state.nodes).toHaveLength(1);
    expect(state.parseIssues).toEqual([]);
    await expectMatchesFullRead(context, state);
  });

  test('normalizes ./ and backslash paths for nested files without creating duplicates', async () => {
    const { spaceDir, context } = makeTempSpace({
      'vision.md': '---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\n',
      'sub/goal.md': '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Our Vision]]"\n---\n',
    });
    let state = await readSpace(context);

    writeFileSync(
      join(spaceDir, 'sub/goal.md'),
      '---\ntype: goal\ntitle: Goal A Updated\nstatus: active\nparent: "[[Our Vision]]"\n---\n',
    );
    state = await refreshReadResult(context, state, ['./sub\\goal.md']);
    expect(state.nodes.filter((n) => n.id === 'sub/goal.md')).toHaveLength(1);
    expect(state.nodes.find((n) => n.id === 'sub/goal.md')?.title).toBe('Goal A Updated');
    await expectMatchesFullRead(context, state);
  });

  test('clears stale resolvedParents on untouched children when a fieldOn: parent link is removed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sctx-refresh-parent-field-'));
    tempDirs.push(root);
    const schemaPath = join(root, 'schema.json');
    writeFileSync(
      schemaPath,
      JSON.stringify({
        oneOf: [
          {
            type: 'object',
            required: ['type', 'title'],
            properties: {
              type: { const: 'activity' },
              title: { type: 'string' },
              tasks: { type: 'array', items: { type: 'string' } },
            },
          },
          {
            type: 'object',
            required: ['type', 'title'],
            properties: { type: { const: 'task' }, title: { type: 'string' } },
          },
        ],
        $metadata: {
          hierarchy: {
            levels: ['activity', { type: 'task', field: 'tasks', fieldOn: 'parent', multiple: true }],
          },
        },
      }),
    );
    const spaceDir = join(root, 'space');
    mkdirSync(spaceDir, { recursive: true });
    writeFileSync(join(spaceDir, 'act.md'), '---\ntype: activity\ntitle: Act 1\ntasks: ["[[Task 1]]"]\n---\n');
    writeFileSync(join(spaceDir, 'task.md'), '---\ntype: task\ntitle: Task 1\n---\n');

    const config: Config = { spaces: [{ name: 'test', path: spaceDir, schema: schemaPath }] };
    const context = createSpaceContext('test', config, { configDir: root });
    let state = await readSpace(context);
    expect(state.nodes.find((n) => n.id === 'task.md')?.resolvedParents).toHaveLength(1);

    // Remove the link on act.md; untouched task.md must lose its resolvedParent
    writeFileSync(join(spaceDir, 'act.md'), '---\ntype: activity\ntitle: Act 1\ntasks: []\n---\n');
    state = await refreshReadResult(context, state, ['act.md']);
    expect(state.nodes.find((n) => n.id === 'task.md')?.resolvedParents).toEqual([]);
    await expectMatchesFullRead(context, state);
  });

  test('falls back to a full read for space_on_a_page spaces', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sctx-refresh-soap-'));
    tempDirs.push(root);
    const soapPath = join(root, 'plan.md');
    writeFileSync(soapPath, '---\ntype: space_on_a_page\n---\n# Vision A\n', 'utf-8');
    const config: Config = {
      spaces: [{ name: 'soap', path: soapPath, schema: 'strategy_general.json' }],
    };
    const context = createSpaceContext('soap', config, { configDir: root });
    const initial = await readSpace(context);
    expect(initial.nodes).toHaveLength(1);

    writeFileSync(soapPath, '---\ntype: space_on_a_page\n---\n# Vision A\n## Goal B\n', 'utf-8');
    const refreshed = await refreshReadResult(context, initial, ['plan.md']);
    expect(refreshed.nodes).toHaveLength(2);
    await expectMatchesFullRead(context, refreshed);
  });
});
