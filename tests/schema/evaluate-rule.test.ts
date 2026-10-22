import { describe, expect, it } from 'bun:test';
import {
  buildEvalContext,
  ExpressionError,
  evaluateExpression,
  tryEvaluateExpression,
} from '../../src/schema/evaluate-rule';
import type { NodeId, SpaceNode } from '../../src/types';
import { makeParentRef } from '../test-helpers';

describe('evaluate-rule', () => {
  describe('evaluateExpression', () => {
    const mockNode: SpaceNode = {
      id: 'Test Node' as NodeId,
      title: 'Test Node',
      type: 'solution',
      schemaData: {
        title: 'Test Node',
        type: 'solution',
        status: 'active',
        parent: '[[Parent Opportunity]]',
      },
      linkTargets: ['Test Node'],
      resolvedParents: [makeParentRef('Parent Opportunity')],
      resolvedType: 'solution',
      resolvedLinks: [],
    };

    const mockParent: SpaceNode = {
      id: 'Parent Opportunity' as NodeId,
      title: 'Parent Opportunity',
      type: 'opportunity',
      schemaData: {
        title: 'Parent Opportunity',
        type: 'opportunity',
        status: 'active',
      },
      linkTargets: ['Parent Opportunity'],
      resolvedParents: [],
      resolvedType: 'opportunity',
      resolvedLinks: [],
    };

    const mockNodeIndex = new Map<NodeId, SpaceNode>([
      ['Test Node' as NodeId, mockNode],
      ['Parent Opportunity' as NodeId, mockParent],
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
        id: 'Orphan Node' as NodeId,
        title: 'Orphan Node',
        type: 'outcome',
        schemaData: {
          title: 'Orphan Node',
          type: 'outcome',
          status: 'active',
        },
        linkTargets: ['Orphan Node'],
        resolvedParents: [],
        resolvedType: 'goal', // outcome is an alias for goal
        resolvedLinks: [],
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

    it('throws on an expression evaluation error, which tryEvaluateExpression reports as data', async () => {
      const context = buildEvalContext(mockNode, allNodes, mockNodeIndex);
      await expect(evaluateExpression('invalid.syntax.('!, context)).rejects.toThrow(ExpressionError);
      expect(await tryEvaluateExpression('invalid.syntax.('!, context)).toHaveProperty('error');
    });
  });

  describe('buildEvalContext', () => {
    const childNode: SpaceNode = {
      id: 'Child' as NodeId,
      title: 'Child',
      type: 'solution',
      schemaData: { title: 'Child', type: 'solution', parent: '[[Parent]]' },
      linkTargets: ['Child'],
      resolvedParents: [makeParentRef('Parent')],
      resolvedType: 'solution',
      resolvedLinks: [],
    };

    const parentNode: SpaceNode = {
      id: 'Parent' as NodeId,
      title: 'Parent',
      type: 'opportunity',
      schemaData: { title: 'Parent', type: 'opportunity' },
      linkTargets: ['Parent'],
      resolvedParents: [],
      resolvedType: 'opportunity',
      resolvedLinks: [],
    };

    const mockNodes = [childNode, parentNode];

    const nodeIndex = new Map<NodeId, SpaceNode>([
      ['Child' as NodeId, childNode],
      ['Parent' as NodeId, parentNode],
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
        id: 'Orphan' as NodeId,
        title: 'Orphan',
        type: 'outcome',
        schemaData: { title: 'Orphan', type: 'outcome' },
        linkTargets: ['Orphan'],
        resolvedParents: [],
        resolvedType: 'goal', // outcome is an alias for goal
        resolvedLinks: [],
      };
      const context = buildEvalContext(orphanNode, mockNodes, nodeIndex);
      expect(context.parent).toBeUndefined();
    });
  });
});
