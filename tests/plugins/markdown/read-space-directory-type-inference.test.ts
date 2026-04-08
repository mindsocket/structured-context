import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceDirectory } from '../../../src/plugins/markdown/read-space';
import { inferTypeFromPath } from '../../../src/plugins/markdown/util';
import { bundledSchemasDir } from '../../../src/schema/schema';
import { makePluginContext } from '../../helpers/context';

const KNOWLEDGE_WIKI_SCHEMA = join(bundledSchemasDir, 'knowledge_wiki.json');
const FIXTURE_DIR = join(import.meta.dir, '../../fixtures/type-inference');

// knowledge_wiki types and aliases
const KNOWN_TYPES = new Set(['source', 'concept', 'synthesis', 'note', 'index']);
const TYPE_ALIASES: Record<string, string> = {
  source_summary: 'source',
  study: 'source',
  article: 'source',
  paper: 'source',
  research: 'source',
};

describe('inferTypeFromPath', () => {
  describe('mode: off', () => {
    it('returns undefined regardless of path', () => {
      expect(inferTypeFromPath('concept/page.md', { mode: 'off' }, KNOWN_TYPES, TYPE_ALIASES)).toBeUndefined();
    });
  });

  describe('folder-name mode (default)', () => {
    it('matches canonical type name', () => {
      expect(inferTypeFromPath('concept/page.md', {}, KNOWN_TYPES, undefined)).toBe('concept');
    });

    it('matches canonical type name case-insensitively', () => {
      expect(inferTypeFromPath('Concept/page.md', {}, KNOWN_TYPES, undefined)).toBe('concept');
      expect(inferTypeFromPath('NOTE/page.md', {}, KNOWN_TYPES, undefined)).toBe('note');
    });

    it('matches alias key and returns canonical type', () => {
      expect(inferTypeFromPath('study/page.md', {}, KNOWN_TYPES, TYPE_ALIASES)).toBe('source');
    });

    it('matches alias key case-insensitively', () => {
      expect(inferTypeFromPath('Study/page.md', {}, KNOWN_TYPES, TYPE_ALIASES)).toBe('source');
      expect(inferTypeFromPath('STUDY/page.md', {}, KNOWN_TYPES, TYPE_ALIASES)).toBe('source');
    });

    it('does not match plural folder name without a matching alias', () => {
      expect(inferTypeFromPath('sources/page.md', {}, KNOWN_TYPES, TYPE_ALIASES)).toBeUndefined();
    });

    it('returns undefined for files at space root', () => {
      expect(inferTypeFromPath('page.md', {}, KNOWN_TYPES, TYPE_ALIASES)).toBeUndefined();
    });

    it('uses leaf directory only, not parent dirs', () => {
      expect(inferTypeFromPath('archives/concept/page.md', {}, KNOWN_TYPES, undefined)).toBe('concept');
      expect(inferTypeFromPath('archives/unknown/page.md', {}, KNOWN_TYPES, undefined)).toBeUndefined();
    });
  });

  describe('folderMap mode', () => {
    it('infers type from mapped folder', () => {
      const cfg = { folderMap: { Research: 'source' } };
      expect(inferTypeFromPath('Research/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toBe('source');
    });

    it('returns undefined for unmapped folder', () => {
      const cfg = { folderMap: { Research: 'source' } };
      expect(inferTypeFromPath('Personal/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toBeUndefined();
    });

    it('matches nested path exactly', () => {
      const cfg = { folderMap: { 'topics/concepts': 'concept' } };
      expect(inferTypeFromPath('topics/concepts/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toBe('concept');
    });

    it('longest-prefix wins when keys overlap', () => {
      const cfg = { folderMap: { 'a/b': 'note', 'a/b/c': 'concept' } };
      expect(inferTypeFromPath('a/b/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toBe('note');
      expect(inferTypeFromPath('a/b/c/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toBe('concept');
    });

    it('normalises trailing slash in key', () => {
      const cfg = { folderMap: { 'Research/': 'source' } };
      expect(inferTypeFromPath('Research/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toBe('source');
    });

    it('resolves folderMap value that is an alias', () => {
      const cfg = { folderMap: { Research: 'study' } };
      expect(inferTypeFromPath('Research/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toBe('source');
    });

    it('throws hard error for unresolvable folderMap value', () => {
      const cfg = { folderMap: { Research: 'unknown-type' } };
      expect(() => inferTypeFromPath('Research/page.md', cfg, KNOWN_TYPES, TYPE_ALIASES)).toThrow(/unknown-type/);
    });
  });
});

describe('readSpaceDirectory with type inference', () => {
  describe('folder-name mode', () => {
    it('infers type from leaf directory matching canonical type', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { mode: 'folder-name' },
      });
      const result = await readSpaceDirectory(ctx);
      const node = result.nodes.find((n) => n.label === 'concept/concept-page.md');
      expect(node).toBeDefined();
      expect(node?.type).toBe('concept');
    });

    it('infers type via alias (study → source)', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { mode: 'folder-name' },
      });
      const result = await readSpaceDirectory(ctx);
      const node = result.nodes.find((n) => n.label === 'study/study-page.md');
      expect(node).toBeDefined();
      expect(node?.type).toBe('source');
    });

    it('infers via alias case-insensitively (Study → source)', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { mode: 'folder-name' },
      });
      const result = await readSpaceDirectory(ctx);
      const node = result.nodes.find((n) => n.label.toLowerCase() === 'study/case-insensitive.md');
      expect(node).toBeDefined();
      expect(node?.type).toBe('source');
    });

    it('does not infer for plural folder with no alias (sources/)', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { mode: 'folder-name' },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.parseIssues.map((i) => i.file)).toContain('sources/sources-page.md');
    });

    it('explicit type in frontmatter overrides inferred type', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { mode: 'folder-name' },
      });
      const result = await readSpaceDirectory(ctx);
      const node = result.nodes.find((n) => n.label === 'note/explicit-type.md');
      expect(node).toBeDefined();
      expect(node?.type).toBe('synthesis');
    });

    it('does not infer for file at space root', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { mode: 'folder-name' },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.parseIssues.map((i) => i.file)).toContain('root-page.md');
    });
  });

  describe('mode: off', () => {
    it('does not infer type when mode is off', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { mode: 'off' },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.nodes.find((n) => n.label === 'concept/concept-page.md')).toBeUndefined();
      expect(result.parseIssues.map((i) => i.file)).toContain('concept/concept-page.md');
    });
  });

  describe('no typeInference config', () => {
    it('does not infer type when typeInference is not configured', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA);
      const result = await readSpaceDirectory(ctx);
      expect(result.nodes.find((n) => n.label === 'concept/concept-page.md')).toBeUndefined();
      expect(result.parseIssues.map((i) => i.file)).toContain('concept/concept-page.md');
    });
  });

  describe('folderMap mode', () => {
    it('infers type from mapped folder', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { folderMap: { Research: 'source', Personal: 'note' } },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.nodes.find((n) => n.label === 'Research/research-page.md')?.type).toBe('source');
      expect(result.nodes.find((n) => n.label === 'Personal/personal-page.md')?.type).toBe('note');
    });

    it('does not infer for unmapped folder', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { folderMap: { Research: 'source' } },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.parseIssues.map((i) => i.file)).toContain('Personal/personal-page.md');
    });

    it('infers from nested path key', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { folderMap: { 'topics/concepts': 'concept' } },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.nodes.find((n) => n.label === 'topics/concepts/nested-concept.md')?.type).toBe('concept');
    });

    it('longest-prefix wins', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { folderMap: { 'a/b': 'note', 'a/b/c': 'concept' } },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.nodes.find((n) => n.label === 'a/b/shallow.md')?.type).toBe('note');
      expect(result.nodes.find((n) => n.label === 'a/b/c/deep.md')?.type).toBe('concept');
    });

    it('folderMap value can be an alias', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { folderMap: { Research: 'study' } },
      });
      const result = await readSpaceDirectory(ctx);
      expect(result.nodes.find((n) => n.label === 'Research/research-page.md')?.type).toBe('source');
    });

    it('throws for unresolvable folderMap value', async () => {
      const ctx = makePluginContext(FIXTURE_DIR, KNOWLEDGE_WIKI_SCHEMA, {
        typeInference: { folderMap: { Research: 'unknown-type' } },
      });
      expect(readSpaceDirectory(ctx)).rejects.toThrow(/unknown-type/);
    });
  });
});
