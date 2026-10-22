import { describe, expect, it } from 'bun:test';
import { buildSpaceGraph } from '../src/space-graph';
import type { NodeId, SpaceNode } from '../src/types';
import { makeHierarchy, makeLevel, makeParentRef } from './test-helpers';

const levels = [makeLevel('goal'), makeLevel('opportunity'), makeLevel('solution')];

function makeNode(title: string, type: string): SpaceNode {
  return {
    id: title as NodeId,
    title,
    type,
    schemaData: { title, type },
    linkTargets: [title],
    resolvedType: type,
    resolvedParents: [],
    resolvedLinks: [],
  };
}

describe('buildSpaceGraph', () => {
  describe('nodes map', () => {
    it('builds a map of all nodes keyed by title', () => {
      const goal = makeNode('My Goal', 'goal');
      const graph = buildSpaceGraph([goal], makeHierarchy(levels));
      expect(graph.nodes.get('My Goal' as NodeId)).toBe(goal);
      expect(graph.nodes.size).toBe(1);
    });

    it('preserves insertion order', () => {
      const goal = makeNode('My Goal', 'goal');
      const opp = makeNode('An Opportunity', 'opportunity');
      const graph = buildSpaceGraph([goal, opp], makeHierarchy(levels));
      expect([...graph.nodes.keys()] as string[]).toEqual(['My Goal', 'An Opportunity']);
    });
  });

  describe('classification', () => {
    it('classifies root-type nodes with no parents as hierarchyRoot', () => {
      const goal = makeNode('My Goal', 'goal');
      const graph = buildSpaceGraph([goal], makeHierarchy(levels));
      expect(graph.hierarchyRoots).toContain(goal);
    });

    it('classifies non-root hierarchy nodes with no parents as orphan', () => {
      const opp = makeNode('Orphaned Opp', 'opportunity');
      const graph = buildSpaceGraph([opp], makeHierarchy(levels));
      expect(graph.orphans).toContain(opp);
    });

    it('classifies non-root hierarchy nodes with valid parents as hierarchyChild', () => {
      const goal = makeNode('My Goal', 'goal');
      const opp = makeNode('An Opportunity', 'opportunity');
      opp.resolvedParents = [makeParentRef('My Goal')];
      const graph = buildSpaceGraph([goal, opp], makeHierarchy(levels));
      expect(graph.hierarchyChildren.get('My Goal' as NodeId)).toContain(opp);
    });

    it('classifies nodes with dangling hierarchy parents as orphan', () => {
      const opp = makeNode('Orphaned Opp', 'opportunity');
      opp.resolvedParents = [makeParentRef('Missing Goal')];
      const graph = buildSpaceGraph([opp], makeHierarchy(levels));
      expect(graph.orphans).toContain(opp);
    });

    it('classifies nodes not in hierarchy levels as nonHierarchy', () => {
      const dashboard = makeNode('My Dashboard', 'dashboard');
      const graph = buildSpaceGraph([dashboard], makeHierarchy(levels));
      expect(graph.nonHierarchy).toContain(dashboard);
    });

    it('handles empty node list', () => {
      const graph = buildSpaceGraph([], makeHierarchy(levels));
      expect(graph.hierarchyRoots).toHaveLength(0);
      expect(graph.orphans).toHaveLength(0);
      expect(graph.nonHierarchy).toHaveLength(0);
      expect(graph.nodes.size).toBe(0);
    });
  });

  describe('hierarchyChildren', () => {
    it('maps parent to hierarchy children only', () => {
      const goal = makeNode('My Goal', 'goal');
      const opp = makeNode('An Opportunity', 'opportunity');
      opp.resolvedParents = [makeParentRef('My Goal', { source: 'hierarchy' })];
      const graph = buildSpaceGraph([goal, opp], makeHierarchy(levels));
      expect(graph.hierarchyChildren.get('My Goal' as NodeId)).toContain(opp);
    });

    it('excludes relationship edges from hierarchyChildren', () => {
      const goal = makeNode('My Goal', 'goal');
      const opp = makeNode('An Opportunity', 'opportunity');
      opp.resolvedParents = [makeParentRef('My Goal', { source: 'relationship' })];
      const graph = buildSpaceGraph([goal, opp], makeHierarchy(levels));
      expect(graph.hierarchyChildren.get('My Goal' as NodeId)).toHaveLength(0);
    });

    it('initialises empty array for leaf nodes', () => {
      const leaf = makeNode('Leaf', 'solution');
      const graph = buildSpaceGraph([leaf], makeHierarchy(levels));
      expect(graph.hierarchyChildren.get('Leaf' as NodeId)).toEqual([]);
    });
  });

  describe('children (all edges)', () => {
    it('includes both hierarchy and relationship children', () => {
      const goal = makeNode('My Goal', 'goal');
      const opp = makeNode('An Opportunity', 'opportunity');
      const assumption = makeNode('An Assumption', 'assumption');
      opp.resolvedParents = [makeParentRef('My Goal', { source: 'hierarchy' })];
      assumption.resolvedParents = [makeParentRef('My Goal', { source: 'relationship', field: 'assumptions' })];
      const graph = buildSpaceGraph([goal, opp, assumption], makeHierarchy(levels));
      const children = graph.children.get('My Goal' as NodeId) ?? [];
      expect(children).toContain(opp);
      expect(children).toContain(assumption);
    });

    it('populates children map for parents not in the node set', () => {
      const opp = makeNode('An Opportunity', 'opportunity');
      opp.resolvedParents = [makeParentRef('Missing Goal')];
      const graph = buildSpaceGraph([opp], makeHierarchy(levels));
      expect(graph.children.get('Missing Goal' as NodeId)).toContain(opp);
    });
  });

  describe('hierarchyIds', () => {
    it('includes hierarchy roots and their descendants', () => {
      const goal = makeNode('My Goal', 'goal');
      const opp = makeNode('An Opportunity', 'opportunity');
      opp.resolvedParents = [makeParentRef('My Goal')];
      const graph = buildSpaceGraph([goal, opp], makeHierarchy(levels));
      expect(graph.hierarchyIds.has('My Goal' as NodeId)).toBe(true);
      expect(graph.hierarchyIds.has('An Opportunity' as NodeId)).toBe(true);
    });

    it('includes orphans', () => {
      const opp = makeNode('Orphaned Opp', 'opportunity');
      const graph = buildSpaceGraph([opp], makeHierarchy(levels));
      expect(graph.hierarchyIds.has('Orphaned Opp' as NodeId)).toBe(true);
    });

    it('excludes non-hierarchy nodes', () => {
      const dashboard = makeNode('My Dashboard', 'dashboard');
      const graph = buildSpaceGraph([dashboard], makeHierarchy(levels));
      expect(graph.hierarchyIds.has('My Dashboard' as NodeId)).toBe(false);
    });
  });

  describe('hierarchy', () => {
    it('stores the hierarchy used to build the graph', () => {
      const hierarchy = makeHierarchy(levels);
      const graph = buildSpaceGraph([], hierarchy);
      expect(graph.hierarchy).toBe(hierarchy);
    });
  });
});
