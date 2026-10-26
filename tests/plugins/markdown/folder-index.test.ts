import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readSpaceDirectory } from '../../../src/plugins/markdown/read-space';
import { defaultPageTitle, pathLinkTargets } from '../../../src/plugins/markdown/util';
import { resolveGraphEdges } from '../../../src/read/resolve-graph-edges';
import { bundledSchemasDir, loadMetadata } from '../../../src/schema/schema';
import type { NodeId, SpaceNode, UnresolvedRef } from '../../../src/types';
import { validateSpace } from '../../../src/validate';
import { makePluginContext, makeSpaceContext } from '../../helpers/context';

const PAGES: Record<string, string> = {
  'Vision.md': 'type: vision',
  'Mission.md': 'type: mission\nparent: "[[Vision]]"',
  'Overview.md': 'type: goal\nparent: "[[Mission]]"',
  'alpha/Overview.md': 'type: goal\nparent: "[[Mission]]"',
  'beta/Overview.md': 'type: goal\nparent: "[[Mission]]"',
  'gamma/Overview.md': 'type: goal\ntitle: Gamma Goal\nparent: "[[Mission]]"',
  'alpha/Notes.md': 'type: opportunity\nparent: "[[alpha/Overview]]"',
  'beta/Notes.md': 'type: opportunity\nparent: "[[projects/beta/Overview]]"',
  'gamma/Notes.md': 'type: opportunity\nparent: "[[Overview]]"',
};
const EMBEDDED = '\n## Detail [type:: opportunity]\n';

const DIR = mkdtempSync(join(tmpdir(), 'sctx-folder-index-'));
for (const [file, frontmatter] of Object.entries(PAGES)) {
  const path = join(DIR, file);
  mkdirSync(dirname(path), { recursive: true });
  const embedded = file === 'alpha/Overview.md' || file === 'beta/Overview.md' ? EMBEDDED : '';
  writeFileSync(path, `---\n${frontmatter}\nstatus: active\n---\n${embedded}`);
}
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const metadata = loadMetadata(join(bundledSchemasDir, 'strategy_general.json'));

describe('pathLinkTargets', () => {
  it('lists the path without extension and every shorter suffix, most specific first', () => {
    expect(pathLinkTargets('projects/alpha/Overview.md')).toEqual([
      'projects/alpha/Overview',
      'alpha/Overview',
      'Overview',
    ]);
  });

  it('returns just the basename for a file at the space root', () => {
    expect(pathLinkTargets('Overview.md')).toEqual(['Overview']);
  });
});

describe('defaultPageTitle', () => {
  it('uses the basename when no folder index is configured', () => {
    expect(defaultPageTitle('alpha/Overview.md', undefined)).toBe('Overview');
    expect(defaultPageTitle('alpha/Overview.md', [])).toBe('Overview');
  });

  it('uses the containing folder name for a folder index, matched case-insensitively', () => {
    expect(defaultPageTitle('alpha/Overview.md', ['overview'])).toBe('alpha');
    expect(defaultPageTitle('projects/Alpha/index.md', ['Overview', 'INDEX'])).toBe('Alpha');
  });

  it('keeps the basename for a folder index at the space root', () => {
    expect(defaultPageTitle('Overview.md', ['Overview'])).toBe('Overview');
  });

  it('keeps the basename for files that are not folder indexes', () => {
    expect(defaultPageTitle('alpha/Notes.md', ['Overview'])).toBe('Notes');
  });
});

describe('same-named pages in different folders', () => {
  let nodes: SpaceNode[];
  let unresolvedRefs: UnresolvedRef[];
  const byId = (id: string) => nodes.find((n) => n.id === id)!;

  beforeAll(async () => {
    const result = await readSpaceDirectory(makePluginContext(DIR, undefined, { folderIndex: ['Overview'] }));
    ({ nodes, unresolvedRefs } = resolveGraphEdges(result.nodes, metadata));
  });

  it('gives each page its space-relative path as id', () => {
    expect(byId('alpha/Overview.md')).toBeDefined();
    expect(byId('beta/Overview.md')).toBeDefined();
    expect(byId('Overview.md')).toBeDefined();
  });

  it('titles a folder index after its folder, and a root folder index after its basename', () => {
    expect(byId('alpha/Overview.md').title).toBe('alpha');
    expect(byId('beta/Overview.md').title).toBe('beta');
    expect(byId('Overview.md').title).toBe('Overview');
  });

  it('sets schemaData.title to the display title', () => {
    expect(byId('alpha/Overview.md').schemaData.title).toBe('alpha');
  });

  it('leaves an explicit title untouched', () => {
    expect(byId('gamma/Overview.md').title).toBe('Gamma Goal');
    expect(byId('gamma/Overview.md').linkTargets).toContain('Gamma Goal');
  });

  it('does not make a folder-index-derived title a link target', () => {
    expect(byId('alpha/Overview.md').linkTargets).not.toContain('alpha');
    expect(byId('alpha/Overview.md').linkTargets).toEqual(['alpha/Overview', 'Overview']);
  });

  it('resolves a path-qualified link to the right page', () => {
    expect(byId('alpha/Notes.md').resolvedParents.map((p) => p.id as string)).toEqual(['alpha/Overview.md']);
  });

  it('does not resolve a path that is not a suffix of any page path', () => {
    expect(byId('beta/Notes.md').resolvedParents).toEqual([]);
    expect(unresolvedRefs).toContainEqual(
      expect.objectContaining({ id: 'beta/Notes.md', ref: '[[projects/beta/Overview]]', reason: 'not_found' }),
    );
  });

  it('reports a bare name shared by several pages as ambiguous', () => {
    expect(byId('gamma/Notes.md').resolvedParents).toEqual([]);
    expect(unresolvedRefs).toContainEqual(
      expect.objectContaining({ id: 'gamma/Notes.md', ref: '[[Overview]]', reason: 'ambiguous' }),
    );
  });

  it('resolves embedded nodes under each duplicated page name to their own page', () => {
    const details = nodes.filter((n) => n.title === 'Detail');
    expect(details.map((n) => n.id as string).sort()).toEqual(['alpha/Overview.md#Detail', 'beta/Overview.md#Detail']);
    const parentOf = (id: string) => nodes.find((n) => n.id === id)!.resolvedParents.map((p) => p.id as string);
    expect(parentOf('alpha/Overview.md#Detail')).toEqual(['alpha/Overview.md']);
    expect(parentOf('beta/Overview.md#Detail')).toEqual(['beta/Overview.md']);
  });

  it('writes the full path form in generated parent links', () => {
    expect(byId('alpha/Overview.md#Detail').schemaData.parent).toBe('[[alpha/Overview]]');
  });
});

describe('folderIndex off', () => {
  it('titles pages after their basename', async () => {
    const result = await readSpaceDirectory(makePluginContext(DIR));
    expect(result.nodes.find((n) => n.id === 'alpha/Overview.md')?.title).toBe('Overview');
  });
});

describe('validation', () => {
  it('does not report same-named pages as duplicates', async () => {
    const result = await validateSpace(makeSpaceContext(DIR));
    expect(result.duplicateErrors).toEqual([]);
  });

  it('reports a duplicate when two nodes share an id', async () => {
    const result = await validateSpace(makeSpaceContext(DIR), {
      readResult: await (async () => {
        const read = await readSpaceDirectory(makePluginContext(DIR));
        const page = read.nodes.find((n) => n.id === 'alpha/Overview.md')!;
        const { nodes, unresolvedRefs } = resolveGraphEdges(
          [...read.nodes, { ...page, id: page.id as NodeId }],
          metadata,
        );
        return { nodes, parseIssues: [], diagnostics: {}, source: 'test', unresolvedRefs };
      })(),
    });
    expect(result.duplicateErrors.map((d) => d.id as string)).toEqual(['alpha/Overview.md']);
  });
});

describe('non-string title', () => {
  it('is reported by validation instead of breaking link resolution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sctx-bad-title-'));
    try {
      writeFileSync(join(dir, 'Numeric.md'), '---\ntype: goal\ntitle: 42\n---\n');
      writeFileSync(join(dir, 'Empty.md'), '---\ntype: goal\ntitle:\n---\n');
      const result = await validateSpace(makeSpaceContext(dir));
      expect(result.nodeErrors.map((e) => e.file).sort()).toEqual(['Empty.md', 'Numeric.md']);
      for (const { errors } of result.nodeErrors) {
        expect(errors.some((e) => e.instancePath === '/title' && e.keyword === 'type')).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
