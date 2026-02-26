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

    it('returns 9 OST nodes (5 original + 1 hybrid_vision file + 2 embedded + 1 hybrid_solution)', () => {
      expect(result.nodes).toHaveLength(9);
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

    it('Community OST.md (ost_on_a_page with no body) contributes no nodes', () => {
      expect(result.nodes.every((n) => n.label !== 'Community OST.md')).toBe(true);
      expect(result.nodes.every((n) => !n.label.startsWith('Community OST#'))).toBe(true);
    });

    it('Community OST.md does not appear in skipped or nonOst', () => {
      expect(result.skipped.includes('Community OST.md')).toBe(false);
      expect(result.nonOst.includes('Community OST.md')).toBe(false);
    });
  });

  describe('hybrid page support', () => {
    let result: SpaceReadResult;

    beforeAll(async () => {
      result = await readSpace(VALID_DIR);
    });

    it('includes hybrid_vision.md as its own node', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_vision.md');
      expect(node).toBeDefined();
      expect(node?.data.type).toBe('vision');
      expect(node?.data.title).toBe('hybrid_vision');
    });

    it('extracts embedded mission with compound label', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_vision.md#Embedded Mission');
      expect(node).toBeDefined();
      expect(node?.data.type).toBe('mission');
      expect(node?.data.title).toBe('Embedded Mission');
    });

    it('embedded mission parent points to the vision file', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_vision.md#Embedded Mission');
      expect(node?.data.parent).toBe('[[hybrid_vision]]');
    });

    it('stores anchor on embedded mission node', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_vision.md#Embedded Mission');
      expect(node?.data.anchor).toBe('embmission');
    });

    it('extracts nested embedded goal with compound label', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_vision.md#Embedded Goal');
      expect(node).toBeDefined();
      expect(node?.data.type).toBe('goal');
    });

    it('embedded goal parent points to the embedded mission via filename#title', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_vision.md#Embedded Goal');
      expect(node?.data.parent).toBe('[[hybrid_vision#Embedded Mission]]');
    });

    it('hybrid_solution.md references embedded goal as parent', () => {
      const node = result.nodes.find((n) => n.label === 'hybrid_solution.md');
      expect(node?.data.parent).toBe('[[hybrid_vision#Embedded Goal]]');
    });
  });

  describe('invalid-ost directory', () => {
    it('returns all 3 nodes regardless of schema validity', async () => {
      const result = await readSpace(INVALID_DIR);
      expect(result.nodes).toHaveLength(3);
    });
  });
});
