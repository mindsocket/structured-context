import { describe, expect, it } from 'bun:test';
import { buildEvalContext, evaluateExpression } from '../src/evaluate-rule';
import type { SpaceNode } from '../src/types';

describe('evaluate-rule', () => {
  describe('evaluateExpression', () => {
    const mockNode: SpaceNode = {
      label: 'test.md',
      schemaData: {
        title: 'Test Node',
        type: 'solution',
        status: 'active',
        parent: '[[Parent Opportunity]]',
      },
      linkTargets: ['Test Node'],
      resolvedParents: ['Parent Opportunity'],
      resolvedType: 'solution',
    };

    const mockParent: SpaceNode = {
      label: 'parent.md',
      schemaData: {
        title: 'Parent Opportunity',
        type: 'opportunity',
        status: 'active',
      },
      linkTargets: ['Parent Opportunity'],
      resolvedParents: [],
      resolvedType: 'opportunity',
    };

    const mockNodeIndex = new Map<string, SpaceNode>([
      ['Test Node', mockNode],
      ['Parent Opportunity', mockParent],
    ]);

    const allNodes = [mockNode, mockParent];

    it('evaluates simple boolean expression returning true', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('true', context);
      expect(result).toBe(true);
    });

    it('evaluates simple boolean expression returning false', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('false', context);
      expect(result).toBe(false);
    });

    it('evaluates expression with current node (current)', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('current.type', context);
      expect(result).toBe('solution');
    });

    it('evaluates expression with all nodes (nodes)', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('$count(nodes)', context);
      expect(result).toBe(2);
    });

    it('evaluates expression with parent access', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('$not(parent) or parent.type = "opportunity"', context);
      expect(result).toBe(true);
    });

    it('evaluates expression with filter lookup', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('nodes[title="Parent Opportunity"].type', context);
      expect(result).toBe('opportunity');
    });

    it('evaluates expression with $exists function', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('$exists(nodes[title="Parent Opportunity"])', context);
      expect(result).toBe(true);
    });

    it('evaluates expression with $exists check for missing parent', async () => {
      const nodeWithoutParent: SpaceNode = {
        label: 'orphan.md',
        schemaData: {
          title: 'Orphan Node',
          type: 'outcome',
          status: 'active',
        },
        linkTargets: ['Orphan Node'],
        resolvedParents: [],
        resolvedType: 'goal', // outcome is an alias for goal
      };
      const context = buildEvalContext(nodeWithoutParent, allNodes, mockNodeIndex);
      const result = await evaluateExpression('$exists(parent) = false', context);
      expect(result).toBe(true);
    });

    it('evaluates complex expression with count and filter', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      const result = await evaluateExpression('$count(nodes[type="solution"])', context);
      expect(result).toBe(1);
    });

    it('returns false on expression evaluation error', async () => {
      // Suppress expected warning for invalid syntax
      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
        const result = await evaluateExpression('invalid.syntax.('!, context);
        expect(result).toBe(false);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('buildEvalContext', () => {
    const childNode: SpaceNode = {
      label: 'child.md',
      schemaData: { title: 'Child', type: 'solution', parent: '[[Parent]]' },
      linkTargets: ['Child'],
      resolvedParents: ['Parent'],
      resolvedType: 'solution',
    };

    const parentNode: SpaceNode = {
      label: 'parent.md',
      schemaData: { title: 'Parent', type: 'opportunity' },
      linkTargets: ['Parent'],
      resolvedParents: [],
      resolvedType: 'opportunity',
    };

    const mockNodes = [childNode, parentNode];

    const nodeIndex = new Map<string, SpaceNode>([
      ['Child', childNode],
      ['Parent', parentNode],
    ]);

    it('builds context with all nodes', () => {
      const context = buildEvalContext(childNode, mockNodes, nodeIndex);
      expect(context.nodes.length).toBe(mockNodes.length);
      // All nodes should be flattened (have title and type at top level)
      expect(context.nodes[0]).toHaveProperty('title');
      expect(context.nodes[0]).toHaveProperty('type');
    });

    it('builds context with current node', () => {
      const context = buildEvalContext(childNode, mockNodes, nodeIndex);
      // Note: The actual evaluation uses 'current' instead of '$$'
      expect(context.$$).toHaveProperty('title', 'Child');
      expect(context.$$).toHaveProperty('type', 'solution');
    });

    it('builds context with resolved parent', () => {
      const context = buildEvalContext(childNode, mockNodes, nodeIndex);
      expect(context.parent).toBeDefined();
      expect(context.parent).toHaveProperty('title', 'Parent');
      expect(context.parent).toHaveProperty('type', 'opportunity');
    });

    it('sets parent to undefined when node has no resolved parent', () => {
      const orphanNode: SpaceNode = {
        label: 'orphan.md',
        schemaData: { title: 'Orphan', type: 'outcome' },
        linkTargets: ['Orphan'],
        resolvedParents: [],
        resolvedType: 'goal', // outcome is an alias for goal
      };
      const context = buildEvalContext(orphanNode, mockNodes, nodeIndex);
      expect(context.parent).toBeUndefined();
    });
  });
});
