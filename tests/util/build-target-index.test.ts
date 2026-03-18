import { describe, expect, it } from 'bun:test';
import { buildTargetIndex } from '../../src/read/wikilink-utils';
import { makeNode } from '../test-helpers';

describe('buildTargetIndex', () => {
  describe('normalization bug - targets should be trimmed', () => {
    it('should trim whitespace from targets before indexing', () => {
      const node1 = makeNode('Target A', 'Type', {}, ['Target A']);
      const node2 = makeNode('Target B', 'Type', {}, ['  Target B  ']); // leading/trailing spaces
      const node3 = makeNode('Target C', 'Type', {}, ['Target C']);

      const index = buildTargetIndex([node1, node2, node3]);

      // Should be able to lookup with trimmed key
      expect(index.get('Target A')).toBe(node1);
      expect(index.get('Target B')).toBe(node2); // This FAILS with current code - no trimming
      expect(index.get('Target C')).toBe(node3);

      // Should NOT have the untrimmed version
      expect(index.has('  Target B  ')).toBe(false); // This FAILS with current code
    });

    it('should treat targets with different whitespace as the same target', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['Target']);
      const node2 = makeNode('Node 2', 'Type', {}, ['  Target']); // leading space
      const node3 = makeNode('Node 3', 'Type', {}, ['Target  ']); // trailing space

      const index = buildTargetIndex([node1, node2, node3]);

      // All three nodes point to the same normalized target, so it should be marked as ambiguous
      expect(index.get('Target')).toBe(null); // This FAILS with current code - no trimming
    });

    it('should handle empty strings after trimming', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['   ']); // only spaces
      const node2 = makeNode('Node 2', 'Type', {}, ['\t\n']); // tabs and newlines
      const node3 = makeNode('Node 3', 'Type', {}, ['Target']);

      const index = buildTargetIndex([node1, node2, node3]);

      // Empty targets should be skipped (not added to index)
      expect(index.has('')).toBe(false); // This FAILS with current code - no empty check
      expect(index.has('   ')).toBe(false); // This FAILS with current code
      expect(index.get('Target')).toBe(node3);
    });

    it('should normalize targets with mixed whitespace', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['  \t Target \n  ']);

      const index = buildTargetIndex([node1]);

      // Should be stored with normalized key
      expect(index.get('Target')).toBe(node1); // This FAILS with current code
      expect(index.has('  \t Target \n  ')).toBe(false); // This FAILS with current code
    });
  });

  describe('duplicate detection - targets pointing to multiple nodes', () => {
    it('should mark target as null when multiple nodes reference it', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['Shared Target']);
      const node2 = makeNode('Node 2', 'Type', {}, ['Shared Target']);
      const node3 = makeNode('Node 3', 'Type', {}, ['Unique Target']);

      const index = buildTargetIndex([node1, node2, node3]);

      // Shared target should be marked as ambiguous
      expect(index.get('Shared Target')).toBe(null);
      expect(index.get('Unique Target')).toBe(node3);
    });

    it('should mark target as null even when duplicates are not adjacent', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['Target A']);
      const node2 = makeNode('Node 2', 'Type', {}, ['Target B']);
      const node3 = makeNode('Node 3', 'Type', {}, ['Target A']); // duplicate of node1
      const node4 = makeNode('Node 4', 'Type', {}, ['Target C']);

      const index = buildTargetIndex([node1, node2, node3, node4]);

      expect(index.get('Target A')).toBe(null);
      expect(index.get('Target B')).toBe(node2);
      expect(index.get('Target C')).toBe(node4);
    });

    it('should handle multiple duplicates of different targets', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['Target A', 'Target B']);
      const node2 = makeNode('Node 2', 'Type', {}, ['Target A', 'Target C']);
      const node3 = makeNode('Node 3', 'Type', {}, ['Target B', 'Target C']);

      const index = buildTargetIndex([node1, node2, node3]);

      // All three targets are referenced by multiple nodes
      expect(index.get('Target A')).toBe(null);
      expect(index.get('Target B')).toBe(null);
      expect(index.get('Target C')).toBe(null);
    });
  });

  describe('combination of normalization and duplicate detection', () => {
    it('should detect duplicates after normalization', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['Target']);
      const node2 = makeNode('Node 2', 'Type', {}, ['  Target  ']); // same target, with spaces
      const node3 = makeNode('Node 3', 'Type', {}, ['Unique']);

      const index = buildTargetIndex([node1, node2, node3]);

      // After normalization, both 'Target' and '  Target  ' are the same
      expect(index.get('Target')).toBe(null); // This FAILS with current code - no trimming
      expect(index.get('Unique')).toBe(node3);
    });

    it('should handle complex case with trimming and duplicates', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['A', 'B']);
      const node2 = makeNode('Node 2', 'Type', {}, ['  A  ', 'C']); // 'A' with spaces
      const node3 = makeNode('Node 3', 'Type', {}, ['  ', 'D']); // empty and 'D'

      const index = buildTargetIndex([node1, node2, node3]);

      // 'A' appears twice (with and without spaces) → ambiguous
      expect(index.get('A')).toBe(null); // This FAILS with current code

      // 'B' appears once
      expect(index.get('B')).toBe(node1);

      // 'C' appears once
      expect(index.get('C')).toBe(node2);

      // 'D' appears once
      expect(index.get('D')).toBe(node3);

      // Empty string should be skipped
      expect(index.has('')).toBe(false); // This FAILS with current code
      expect(index.size).toBe(4); // A, B, C, D (empty string not included)
    });
  });

  describe('edge cases', () => {
    it('should handle empty node list', () => {
      const index = buildTargetIndex([]);
      expect(index.size).toBe(0);
    });

    it('should handle node with empty linkTargets array', () => {
      const node1 = makeNode('Node 1', 'Type', {}, []);
      const node2 = makeNode('Node 2', 'Type', {}, ['Target']);

      const index = buildTargetIndex([node1, node2]);

      expect(index.size).toBe(1);
      expect(index.get('Target')).toBe(node2);
    });

    it('should handle node with multiple targets including duplicates', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['Target A', 'Target B', 'Target A']);
      const node2 = makeNode('Node 2', 'Type', {}, ['Target C']);

      const index = buildTargetIndex([node1, node2]);

      // Same node referencing the same target multiple times is OK
      expect(index.get('Target A')).toBe(node1);
      expect(index.get('Target B')).toBe(node1);
      expect(index.get('Target C')).toBe(node2);
    });

    it('should preserve all targets from a node', () => {
      const node1 = makeNode('Node 1', 'Type', {}, ['Target A', 'Target B', 'Target C']);

      const index = buildTargetIndex([node1]);

      expect(index.size).toBe(3);
      expect(index.get('Target A')).toBe(node1);
      expect(index.get('Target B')).toBe(node1);
      expect(index.get('Target C')).toBe(node1);
    });
  });
});
