import { describe, expect, it } from 'bun:test';
import { augmentNode } from '../../src/filter/augment-nodes';
import { buildSpaceGraph } from '../../src/space-graph';
import type { SpaceNode } from '../../src/types';
import { makeParentRef } from '../test-helpers';

function makeNode(title: string, type: string, parentRefs: ReturnType<typeof makeParentRef>[] = []): SpaceNode {
  return {
    label: `${title}.md`,
    title,
    schemaData: { title, type },
    linkTargets: [title],
    type,
    resolvedType: type,
    resolvedParents: parentRefs,
  };
}

function childrenOf(nodes: SpaceNode[]) {
  return buildSpaceGraph(nodes, []).children;
}

describe('augmentNode', () => {
  describe('ancestors', () => {
    it('returns empty ancestors for a root node', () => {
      const root = makeNode('Root', 'goal');
      const nodeIndex = new Map([['Root', root]]);
      const result = augmentNode(root, nodeIndex, childrenOf([root]));
      expect(result.ancestors).toEqual([]);
    });

    it('includes direct parent as ancestor with edge metadata', () => {
      const root = makeNode('Root', 'goal');
      const child = makeNode('Child', 'opportunity', [makeParentRef('Root')]);
      const nodeIndex = new Map([
        ['Root', root],
        ['Child', child],
      ]);
      const result = augmentNode(child, nodeIndex, childrenOf([root, child]));

      expect(result.ancestors).toHaveLength(1);
      expect(result.ancestors[0]).toMatchObject({
        title: 'Root',
        resolvedType: 'goal',
        _field: 'parent',
        _source: 'hierarchy',
        _selfRef: false,
      });
    });

    it('includes transitive ancestors, nearest first', () => {
      const grandparent = makeNode('Grandparent', 'goal');
      const parent = makeNode('Parent', 'opportunity', [makeParentRef('Grandparent')]);
      const child = makeNode('Child', 'solution', [makeParentRef('Parent')]);
      const nodes = [grandparent, parent, child];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      const result = augmentNode(child, nodeIndex, childrenOf(nodes));

      expect(result.ancestors).toHaveLength(2);
      expect(result.ancestors[0]).toMatchObject({ title: 'Parent' });
      expect(result.ancestors[1]).toMatchObject({ title: 'Grandparent' });
    });

    it('deduplicates ancestors with multiple paths', () => {
      // Diamond DAG: child has two parents, both pointing to same grandparent
      const grandparent = makeNode('Grandparent', 'goal');
      const parent1 = makeNode('Parent 1', 'opportunity', [makeParentRef('Grandparent')]);
      const parent2 = makeNode('Parent 2', 'opportunity', [makeParentRef('Grandparent')]);
      const child = makeNode('Child', 'solution', [makeParentRef('Parent 1'), makeParentRef('Parent 2')]);
      const nodes = [grandparent, parent1, parent2, child];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      const result = augmentNode(child, nodeIndex, childrenOf(nodes));

      const ancestorTitles = result.ancestors.map((a) => a.title);
      // Grandparent appears only once despite two paths
      expect(ancestorTitles.filter((t) => t === 'Grandparent')).toHaveLength(1);
    });

    it('handles cycle detection for selfRef nodes', () => {
      // solution → solution (self-referential hierarchy)
      const solutionA = makeNode('Solution A', 'solution', []);
      const solutionB = makeNode('Solution B', 'solution', [makeParentRef('Solution A', { selfRef: true })]);
      // Make Solution A also point to Solution B to create a cycle
      solutionA.resolvedParents = [makeParentRef('Solution B', { selfRef: true })];
      const nodes = [solutionA, solutionB];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      // Should not throw or infinite loop
      const result = augmentNode(solutionB, nodeIndex, childrenOf(nodes));
      expect(result.ancestors.length).toBeGreaterThan(0);
      // Each title appears at most once
      const titles = result.ancestors.map((a) => a.title);
      expect(new Set(titles).size).toBe(titles.length);
    });

    it('preserves edge metadata from relationship edges', () => {
      const parent = makeNode('Opportunity', 'opportunity');
      const child = makeNode('Assumption', 'assumption', [
        makeParentRef('Opportunity', { source: 'relationship', field: 'assumptions', selfRef: false }),
      ]);
      const nodes = [parent, child];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      const result = augmentNode(child, nodeIndex, childrenOf(nodes));

      expect(result.ancestors[0]).toMatchObject({
        _field: 'assumptions',
        _source: 'relationship',
        _selfRef: false,
      });
    });
  });

  describe('descendants', () => {
    it('returns empty descendants for a leaf node', () => {
      const leaf = makeNode('Leaf', 'solution');
      const nodeIndex = new Map([['Leaf', leaf]]);
      const result = augmentNode(leaf, nodeIndex, childrenOf([leaf]));
      expect(result.descendants).toEqual([]);
    });

    it('includes direct children as descendants', () => {
      const root = makeNode('Root', 'goal');
      const child = makeNode('Child', 'opportunity', [makeParentRef('Root')]);
      const nodes = [root, child];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      const result = augmentNode(root, nodeIndex, childrenOf(nodes));

      expect(result.descendants).toHaveLength(1);
      expect(result.descendants[0]).toMatchObject({
        title: 'Child',
        resolvedType: 'opportunity',
        _field: 'parent',
        _source: 'hierarchy',
      });
    });

    it('includes transitive descendants, nearest first', () => {
      const root = makeNode('Root', 'goal');
      const mid = makeNode('Mid', 'opportunity', [makeParentRef('Root')]);
      const leaf = makeNode('Leaf', 'solution', [makeParentRef('Mid')]);
      const nodes = [root, mid, leaf];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      const result = augmentNode(root, nodeIndex, childrenOf(nodes));

      expect(result.descendants).toHaveLength(2);
      expect(result.descendants[0]).toMatchObject({ title: 'Mid' });
      expect(result.descendants[1]).toMatchObject({ title: 'Leaf' });
    });

    it('deduplicates descendants with multiple paths (diamond DAG)', () => {
      const root = makeNode('Root', 'goal');
      const child1 = makeNode('Child 1', 'opportunity', [makeParentRef('Root')]);
      const child2 = makeNode('Child 2', 'opportunity', [makeParentRef('Root')]);
      const grandchild = makeNode('Grandchild', 'solution', [makeParentRef('Child 1'), makeParentRef('Child 2')]);
      const nodes = [root, child1, child2, grandchild];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      const result = augmentNode(root, nodeIndex, childrenOf(nodes));

      const descTitles = result.descendants.map((d) => d.title);
      expect(descTitles.filter((t) => t === 'Grandchild')).toHaveLength(1);
    });
  });

  describe('flat node fields', () => {
    it('includes schemaData fields at the top level', () => {
      const node = makeNode('My Node', 'solution');
      (node.schemaData as Record<string, unknown>).status = 'active';
      const nodeIndex = new Map([['My Node', node]]);

      const result = augmentNode(node, nodeIndex, childrenOf([node]));

      expect(result.status).toBe('active');
      expect(result.resolvedType).toBe('solution');
    });

    it('includes resolvedParentTitles', () => {
      const parent = makeNode('Parent', 'goal');
      const child = makeNode('Child', 'opportunity', [makeParentRef('Parent')]);
      const nodes = [parent, child];
      const nodeIndex = new Map(nodes.map((n) => [n.title, n]));

      const result = augmentNode(child, nodeIndex, childrenOf(nodes));

      expect(result.resolvedParentTitles).toEqual(['Parent']);
    });
  });
});
