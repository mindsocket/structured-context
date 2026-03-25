import { describe, expect, it } from 'bun:test';
import { filterNodes } from '../../src/filter/filter-nodes';
import type { SpaceNode } from '../../src/types';
import { makeParentRef } from '../test-helpers';

function makeNode(title: string, type: string, extra: Record<string, unknown> = {}): SpaceNode {
  return {
    label: `${title}.md`,
    schemaData: { title, type, ...extra },
    linkTargets: [title],
    type,
    resolvedType: type,
    resolvedParents: [],
  };
}

const goal = makeNode('My Goal', 'goal', { status: 'active' });
const activeOpportunity = makeNode('Active Opportunity', 'opportunity', { status: 'active' });
const pausedOpportunity = makeNode('Paused Opportunity', 'opportunity', { status: 'paused' });
const solution1 = { ...makeNode('Solution 1', 'solution', { status: 'active' }) };
const solution2 = { ...makeNode('Solution 2', 'solution', { status: 'paused' }) };

// Wire up parents
solution1.resolvedParents = [makeParentRef('Active Opportunity')];
solution2.resolvedParents = [makeParentRef('Paused Opportunity')];
activeOpportunity.resolvedParents = [makeParentRef('My Goal')];
pausedOpportunity.resolvedParents = [makeParentRef('My Goal')];

const allNodes = [goal, activeOpportunity, pausedOpportunity, solution1, solution2];

describe('filterNodes', () => {
  describe('WHERE clause matching', () => {
    it('filters by resolvedType', async () => {
      const result = await filterNodes("WHERE resolvedType='solution'", allNodes);
      expect(result).toHaveLength(2);
      expect(result.map((n) => n.schemaData.title)).toContain('Solution 1');
      expect(result.map((n) => n.schemaData.title)).toContain('Solution 2');
    });

    it('filters by a schemaData field (status)', async () => {
      const result = await filterNodes("WHERE status='active'", allNodes);
      expect(result.map((n) => n.schemaData.title)).toEqual(['My Goal', 'Active Opportunity', 'Solution 1']);
    });

    it('filters by combined conditions', async () => {
      const result = await filterNodes("WHERE resolvedType='solution' and status='active'", allNodes);
      expect(result).toHaveLength(1);
      expect(result[0]!.schemaData.title).toBe('Solution 1');
    });

    it('returns empty array when nothing matches', async () => {
      const result = await filterNodes("WHERE resolvedType='nonexistent'", allNodes);
      expect(result).toEqual([]);
    });

    it('filters by ancestor attribute using ancestors[] array', async () => {
      // Solutions whose parent opportunity has status='active'
      const result = await filterNodes(
        "WHERE resolvedType='solution' and $exists(ancestors[resolvedType='opportunity' and status='active'])",
        allNodes,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.schemaData.title).toBe('Solution 1');
    });

    it('supports bare JSONata without WHERE keyword', async () => {
      const result = await filterNodes("resolvedType='solution'", allNodes);
      expect(result).toHaveLength(2);
    });
  });

  describe('no filter predicate', () => {
    it('returns all nodes when no WHERE clause', async () => {
      const result = await filterNodes('SELECT ancestors(opportunity)', allNodes);
      // SELECT-only: returns all nodes (no WHERE filter)
      expect(result).toHaveLength(allNodes.length);
    });
  });

  describe('SELECT clause expansion', () => {
    it('expands result with SELECT ancestors when present', async () => {
      // Matched: solutions. Expanded: + their opportunity ancestor.
      const result = await filterNodes("SELECT ancestors(opportunity) WHERE resolvedType='solution'", allNodes);
      const titles = result.map((n) => n.schemaData.title);
      expect(titles).toContain('Solution 1');
      expect(titles).toContain('Active Opportunity'); // ancestor of solution 1
    });

    it('SELECT-only returns all nodes expanded', async () => {
      const result = await filterNodes('SELECT ancestors(opportunity)', allNodes);
      // All nodes returned (SELECT-only = no WHERE filter)
      expect(result.length).toBeGreaterThanOrEqual(allNodes.length);
    });
  });

  describe('return type', () => {
    it('returns the original SpaceNode objects, not augmented representations', async () => {
      const result = await filterNodes("WHERE resolvedType='solution'", allNodes);
      for (const node of result) {
        // Original SpaceNode has resolvedParents; augmented representation would have ancestors[]
        expect(node.resolvedParents).toBeDefined();
        expect(((node as Record<string, unknown>).ancestors)).toBeUndefined();
      }
    });
  });
});
