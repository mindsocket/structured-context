import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { render } from '../../src/commands/render';
import { markdownPlugin } from '../../src/plugins/markdown';
import { renderMarkdownDirectory, sanitizeFilename } from '../../src/plugins/markdown/render-directory';
import type { PluginContext } from '../../src/plugins/util';
import { buildSpaceGraph } from '../../src/space-graph';
import { makeHierarchy, makeLevel, makeNode, makeSpaceNode } from '../../src/testing';
import type { SpaceContext, SpaceNode } from '../../src/types';
import { makePluginContext, makeSpaceContext } from '../helpers/context';

describe('sanitizeFilename', () => {
  it('strips Obsidian and filesystem reserved characters', () => {
    expect(sanitizeFilename('Personal Vision')).toBe('Personal Vision');
    expect(sanitizeFilename('Goal: What / Why?')).toBe('Goal- What - Why');
    expect(sanitizeFilename('Note #1 ^block [draft]')).toBe('Note -1 -block -draft');
    expect(sanitizeFilename('   leading and trailing   ')).toBe('leading and trailing');
    expect(sanitizeFilename('???')).toBe('untitled');
    expect(sanitizeFilename('')).toBe('untitled');
  });
});

describe('renderMarkdownDirectory', () => {
  const hierarchy = makeHierarchy([makeLevel('goal'), makeLevel('opportunity'), makeLevel('solution')]);

  const createTestContext = (markdownConfig: Record<string, unknown> = {}): PluginContext => {
    const ctx = makePluginContext('/tmp/test-space', undefined, markdownConfig);
    ctx.space.plugins = { 'sctx-markdown': markdownConfig };
    return ctx;
  };

  it('renders flat layout by default with frontmatter and body', () => {
    const nodes: SpaceNode[] = [
      makeSpaceNode('Goal 1', 'goal', { status: 'active' }),
      makeSpaceNode('Opportunity 1', 'opportunity', {
        status: 'exploring',
        parent: '[[Goal 1]]',
      }),
    ];
    nodes[0]!.content = 'This is the body of goal 1.';

    const graph = buildSpaceGraph(nodes, hierarchy);
    const ctx = createTestContext();
    const result = renderMarkdownDirectory(ctx, graph, { format: 'directory' });

    expect(result.files).toHaveLength(2);

    const goalFile = result.files.find((f) => f.path === 'Goal 1.md');
    expect(goalFile).toBeDefined();
    const parsedGoal = matter(goalFile!.content);
    expect(parsedGoal.data.type).toBe('goal');
    expect(parsedGoal.data.status).toBe('active');
    expect(parsedGoal.data.title).toBeUndefined(); // Omitted because it matches filename
    expect(parsedGoal.content.trim()).toBe('This is the body of goal 1.');

    const oppFile = result.files.find((f) => f.path === 'Opportunity 1.md');
    expect(oppFile).toBeDefined();
    const parsedOpp = matter(oppFile!.content);
    expect(parsedOpp.data.type).toBe('opportunity');
    expect(parsedOpp.data.parent).toBe('[[Goal 1]]');
  });

  it('preserves title in frontmatter when sanitized filename differs from title', () => {
    const node = makeSpaceNode('Goal: Advance & Win?', 'goal', { status: 'active' });
    const graph = buildSpaceGraph([node], hierarchy);
    const ctx = createTestContext();
    const result = renderMarkdownDirectory(ctx, graph, { format: 'directory' });

    expect(result.files).toHaveLength(1);
    const file = result.files[0]!;
    expect(file.path).toBe('Goal- Advance & Win.md');
    const parsed = matter(file.content);
    expect(parsed.data.title).toBe('Goal: Advance & Win?');
    expect(parsed.data.type).toBe('goal');
  });

  it('disambiguates duplicate file names and preserves titles in frontmatter', () => {
    const node1 = makeSpaceNode('Goal / Strategy', 'goal', { status: 'active' });
    const node2 = makeSpaceNode('Goal - Strategy', 'goal', { status: 'active' });

    const graph = buildSpaceGraph([node1, node2], hierarchy);
    const ctx = createTestContext();
    const result = renderMarkdownDirectory(ctx, graph, { format: 'directory' });

    expect(result.files).toHaveLength(2);
    expect(result.files[0]!.path).toBe('Goal - Strategy.md');
    expect(result.files[1]!.path).toBe('Goal - Strategy-2.md');

    const parsed2 = matter(result.files[1]!.content);
    expect(parsed2.data.title).toBe('Goal - Strategy');
  });

  it('organizes files into per-type subfolders with --data folders=type', () => {
    const nodes: SpaceNode[] = [makeSpaceNode('Goal 1', 'goal'), makeSpaceNode('Opp 1', 'opportunity')];
    const graph = buildSpaceGraph(nodes, hierarchy);
    const ctx = createTestContext();
    const result = renderMarkdownDirectory(ctx, graph, {
      format: 'directory',
      data: { folders: 'type' },
    });

    expect(result.files.map((f) => f.path).sort()).toEqual(['goal/Goal 1.md', 'opportunity/Opp 1.md']);
  });

  it('uses inverted folderMap when typeInference.folderMap is configured', () => {
    const nodes: SpaceNode[] = [
      makeSpaceNode('Concept 1', 'concept'),
      makeSpaceNode('Study 1', 'source'),
      makeSpaceNode('Goal 1', 'goal'),
    ];
    const graph = buildSpaceGraph(nodes, hierarchy);
    const ctx = createTestContext({
      typeInference: {
        mode: 'folderMap',
        folderMap: {
          concepts: 'concept',
          'research/studies': 'source',
        },
      },
    });

    const result = renderMarkdownDirectory(ctx, graph, { format: 'directory' });

    expect(result.files.map((f) => f.path).sort()).toEqual([
      'concepts/Concept 1.md',
      'goal/Goal 1.md', // unmapped type falls back to type name
      'research/studies/Study 1.md',
    ]);
  });

  it('applies reverse fieldMap in frontmatter output', () => {
    const node = makeSpaceNode('Goal 1', 'goal', {
      customField: 'val1',
      status: 'active',
    });
    const graph = buildSpaceGraph([node], hierarchy);
    const ctx = createTestContext({
      fieldMap: {
        file_custom: 'customField',
        my_status: 'status',
      },
    });

    const result = renderMarkdownDirectory(ctx, graph, { format: 'directory' });
    const parsed = matter(result.files[0]!.content);

    expect(parsed.data.file_custom).toBe('val1');
    expect(parsed.data.my_status).toBe('active');
    expect(parsed.data.customField).toBeUndefined();
    expect(parsed.data.status).toBeUndefined();
  });
});

describe('render command with multi-file output', () => {
  const setupTestSpace = () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sctx-render-test-'));
    const spaceDir = join(tempDir, 'space');
    mkdirSync(spaceDir, { recursive: true });

    // Create a simple typed page
    writeFileSync(join(spaceDir, 'Goal.md'), '---\ntype: goal\nstatus: active\n---\n\nBody for goal.\n');

    const spaceContext = makeSpaceContext(spaceDir);
    return { tempDir, spaceDir, spaceContext };
  };

  it('prints a summary when --out is not provided', async () => {
    const { tempDir, spaceContext } = setupTestSpace();
    try {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await render(spaceContext, 'markdown.directory', {});
      } finally {
        console.log = origLog;
      }

      expect(logs.some((l) => l.includes('Rendered 1 file(s):'))).toBe(true);
      expect(logs.some((l) => l.includes('Goal.md'))).toBe(true);
      expect(logs.some((l) => l.includes('Specify --out <dir>'))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes files to --out directory', async () => {
    const { tempDir, spaceContext } = setupTestSpace();
    const outDir = join(tempDir, 'output');
    try {
      await render(spaceContext, 'markdown.directory', { out: outDir });

      const writtenPath = join(outDir, 'Goal.md');
      expect(existsSync(writtenPath)).toBe(true);
      const content = readFileSync(writtenPath, 'utf8');
      expect(content).toContain('type: goal');
      expect(content).toContain('Body for goal.');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite existing files without --force', async () => {
    const { tempDir, spaceContext } = setupTestSpace();
    const outDir = join(tempDir, 'output');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'Goal.md'), 'existing content');

    try {
      await expect(render(spaceContext, 'markdown.directory', { out: outDir })).rejects.toThrow(
        /Refusing to overwrite 1 existing file\(s\)/,
      );

      // With force, succeeds
      await render(spaceContext, 'markdown.directory', { out: outDir, force: true });
      const content = readFileSync(join(outDir, 'Goal.md'), 'utf8');
      expect(content).toContain('type: goal');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
