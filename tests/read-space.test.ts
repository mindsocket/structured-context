import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpace } from '../src/read-space.js';
import type { SpaceReadResult } from '../src/types.js';

const VALID_DIR = join(import.meta.dir, 'fixtures/valid-ost');
const INVALID_DIR = join(import.meta.dir, 'fixtures/invalid-ost');

describe('readSpace', () => {
  describe('valid-ost directory', () => {
    let result: SpaceReadResult;

    beforeAll(async () => {
      result = await readSpace(VALID_DIR);
    });

    it('returns 7 OST nodes (5 original + hybrid_vision + hybrid_solution)', () => {
      expect(result.nodes).toHaveLength(7);
    });

    it('injects title from filename for file-based nodes', () => {
      const vision = result.nodes.find((n) => n.label === 'Personal Vision.md');
      expect(vision?.data.title).toBe('Personal Vision');
    });

    it('skips no-frontmatter.md', () => {
      expect(result.skipped).toContain('no-frontmatter.md');
    });

    it('puts meeting-notes.md in nonOst', () => {
      expect(result.nonOst).toContain('meeting-notes.md');
    });

    it('skipped files do not appear in nodes', () => {
      expect(result.nodes.every((n) => n.label !== 'no-frontmatter.md')).toBe(true);
    });

    it('nonOst files do not appear in nodes', () => {
      expect(result.nodes.every((n) => n.label !== 'meeting-notes.md')).toBe(true);
    });

    it('preserves numeric frontmatter fields on Technical Skills', () => {
      const ts = result.nodes.find((n) => n.label === 'Technical Skills.md');
      expect(ts?.data.impact).toBe(4);
      expect(ts?.data.feasibility).toBe(3);
      expect(ts?.data.resources).toBe(2);
      expect(ts?.data.priority).toBe('p3');
    });

    it('Community OST.md (ost_on_a_page) is excluded from nodes', () => {
      expect(result.nodes.every((n) => n.label !== 'Community OST.md')).toBe(true);
    });

    it('Community OST.md does not appear in skipped or nonOst', () => {
      expect(result.skipped.includes('Community OST.md')).toBe(false);
      expect(result.nonOst.includes('Community OST.md')).toBe(false);
    });
  });

  describe('hybrid file support', () => {
    let result: SpaceReadResult;

    beforeAll(async () => {
      result = await readSpace(VALID_DIR);
    });

    it('includes hybrid_vision.md as a single node (no embedded extraction)', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_vision.md');
      expect(node).toBeDefined();
      expect(node?.data.type).toBe('vision');
      expect(node?.data.title).toBe('hybrid_vision');
    });

    it('does not extract embedded nodes from hybrid files', () => {
      expect(result.nodes.every((n) => !n.label.includes('#'))).toBe(true);
    });

    it('includes hybrid_solution.md with parent pointing to hybrid_vision', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_solution.md');
      expect(node).toBeDefined();
      expect(node?.data.parent).toBe('[[hybrid_vision]]');
    });
  });

  describe('invalid-ost directory', () => {
    it('returns all 3 nodes regardless of schema validity', async () => {
      const result = await readSpace(INVALID_DIR);
      expect(result.nodes).toHaveLength(3);
    });
  });
});
