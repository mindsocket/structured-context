import { describe, expect, it } from 'bun:test';
import { augmentNode } from '../../src/filter/augment-nodes';
import { expandInclude, parseIncludeSpec } from '../../src/filter/expand-include';
import { buildSpaceGraph } from '../../src/space-graph';
import type { SpaceNode } from '../../src/types';
import { makeParentRef } from '../test-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(title: string, type: string, extra: Record<string, unknown> = {}): SpaceNode {
  return {
    label: `${title}.md`,
    title,
    schemaData: { title, type, ...extra },
    linkTargets: [title],
    type,
    resolvedType: type,
    resolvedParents: [],
  };
}

function buildContext(nodes: SpaceNode[]) {
  // Use an empty levels array — expand-include tests don't care about hierarchy classification
  const graph = buildSpaceGraph(nodes, []);
  const nodeIndex = graph.nodes;
  const childrenIndex = graph.children;
  const augmented = new Map(nodes.map((n) => [n.title, augmentNode(n, nodeIndex, childrenIndex)]));
  return { nodeIndex, childrenIndex, augmented };
}

// ---------------------------------------------------------------------------
// parseIncludeSpec
// ---------------------------------------------------------------------------

describe('parseIncludeSpec', () => {
  it('parses bare ancestors', () => {
    expect(parseIncludeSpec('ancestors')).toEqual([{ kind: 'ancestors' }]);
  });

  it('parses ancestors with type filter', () => {
    expect(parseIncludeSpec('ancestors(goal)')).toEqual([{ kind: 'ancestors', typeFilter: 'goal' }]);
  });

  it('parses descendants', () => {
    expect(parseIncludeSpec('descendants')).toEqual([{ kind: 'descendants' }]);
  });

  it('parses descendants with type filter', () => {
    expect(parseIncludeSpec('descendants(solution)')).toEqual([{ kind: 'descendants', typeFilter: 'solution' }]);
  });

  it('parses siblings', () => {
    expect(parseIncludeSpec('siblings')).toEqual([{ kind: 'siblings' }]);
  });

  it('parses bare relationships', () => {
    expect(parseIncludeSpec('relationships')).toEqual([{ kind: 'relationships' }]);
  });

  it('parses relationships with child type', () => {
    expect(parseIncludeSpec('relationships(assumption)')).toEqual([{ kind: 'relationships', childType: 'assumption' }]);
  });

  it('parses relationships with parent:child', () => {
    expect(parseIncludeSpec('relationships(opportunity:assumption)')).toEqual([
      { kind: 'relationships', parentType: 'opportunity', childType: 'assumption' },
    ]);
  });

  it('parses relationships with parent:field:child', () => {
    expect(parseIncludeSpec('relationships(activities:data_produced:data)')).toEqual([
      { kind: 'relationships', parentType: 'activities', field: 'data_produced', childType: 'data' },
    ]);
  });

  it('parses multiple comma-separated directives', () => {
    expect(parseIncludeSpec('ancestors(goal), siblings')).toEqual([
      { kind: 'ancestors', typeFilter: 'goal' },
      { kind: 'siblings' },
    ]);
  });

  it('is case-insensitive for directive names', () => {
    expect(parseIncludeSpec('Ancestors(goal)')).toEqual([{ kind: 'ancestors', typeFilter: 'goal' }]);
    expect(parseIncludeSpec('SIBLINGS')).toEqual([{ kind: 'siblings' }]);
  });

  describe('error cases', () => {
    it('throws on empty spec', () => {
      expect(() => parseIncludeSpec('')).toThrow('must not be empty');
    });

    it('throws on unknown directive', () => {
      expect(() => parseIncludeSpec('parents')).toThrow('Unknown include directive');
    });

    it('throws on range syntax (not yet supported)', () => {
      expect(() => parseIncludeSpec('ancestors(opportunity..goal)')).toThrow('Range syntax');
    });

    it('throws on too many relationship parts', () => {
      expect(() => parseIncludeSpec('relationships(a:b:c:d)')).toThrow('too many parts');
    });

    it('throws on siblings with argument', () => {
      expect(() => parseIncludeSpec('siblings(goal)')).toThrow('does not accept arguments');
    });
  });
});

// ---------------------------------------------------------------------------
// expandInclude
// ---------------------------------------------------------------------------

// Fixture graph:
//   goal → opportunity A → solution 1
//                       → solution 2
//        → opportunity B → solution 3
//
// plus an assumption linked to opportunity A via relationship edge
const goal = makeNode('Goal', 'goal');
const oppA = makeNode('Opportunity A', 'opportunity');
const oppB = makeNode('Opportunity B', 'opportunity');
const sol1 = makeNode('Solution 1', 'solution');
const sol2 = makeNode('Solution 2', 'solution');
const sol3 = makeNode('Solution 3', 'solution');
const assumption = makeNode('Assumption 1', 'assumption');

oppA.resolvedParents = [makeParentRef('Goal')];
oppB.resolvedParents = [makeParentRef('Goal')];
sol1.resolvedParents = [makeParentRef('Opportunity A')];
sol2.resolvedParents = [makeParentRef('Opportunity A')];
sol3.resolvedParents = [makeParentRef('Opportunity B')];
// assumption linked to opportunity A via relationship
assumption.resolvedParents = [makeParentRef('Opportunity A', { source: 'relationship', field: 'assumptions' })];

const allNodes = [goal, oppA, oppB, sol1, sol2, sol3, assumption];
const ctx = buildContext(allNodes);

describe('expandInclude — ancestors', () => {
  it('adds all ancestors of matched nodes', () => {
    const result = expandInclude(
      [sol1],
      parseIncludeSpec('ancestors'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Solution 1');
    expect(titles).toContain('Opportunity A');
    expect(titles).toContain('Goal');
  });

  it('filters ancestors by type', () => {
    const result = expandInclude(
      [sol1],
      parseIncludeSpec('ancestors(goal)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Solution 1');
    expect(titles).toContain('Goal');
    expect(titles).not.toContain('Opportunity A');
  });

  it('deduplicates ancestors when multiple matched nodes share them', () => {
    const result = expandInclude(
      [sol1, sol2],
      parseIncludeSpec('ancestors(goal)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles.filter((t) => t === 'Goal')).toHaveLength(1);
  });
});

describe('expandInclude — descendants', () => {
  it('adds all descendants of matched nodes', () => {
    const result = expandInclude(
      [goal],
      parseIncludeSpec('descendants'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Goal');
    expect(titles).toContain('Opportunity A');
    expect(titles).toContain('Solution 1');
    expect(titles).toContain('Solution 2');
    expect(titles).toContain('Solution 3');
  });

  it('filters descendants by type', () => {
    const result = expandInclude(
      [goal],
      parseIncludeSpec('descendants(solution)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Goal');
    expect(titles).toContain('Solution 1');
    expect(titles).not.toContain('Opportunity A');
  });
});

describe('expandInclude — siblings', () => {
  it('adds sibling nodes (other children of same parent)', () => {
    const result = expandInclude([sol1], parseIncludeSpec('siblings'), ctx.nodeIndex, ctx.childrenIndex, ctx.augmented);
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Solution 1');
    expect(titles).toContain('Solution 2'); // sibling under Opportunity A
    expect(titles).not.toContain('Solution 3'); // under Opportunity B, not a sibling
  });

  it('does not include the matched node as its own sibling', () => {
    const result = expandInclude([sol1], parseIncludeSpec('siblings'), ctx.nodeIndex, ctx.childrenIndex, ctx.augmented);
    const titles = result.map((n) => n.schemaData.title);
    expect(titles.filter((t) => t === 'Solution 1')).toHaveLength(1);
  });
});

describe('expandInclude — relationships', () => {
  it('adds nodes connected via relationship edges (no filter)', () => {
    const result = expandInclude(
      [oppA],
      parseIncludeSpec('relationships'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Opportunity A');
    expect(titles).toContain('Assumption 1');
  });

  it('does not include hierarchy-connected nodes', () => {
    const result = expandInclude(
      [oppA],
      parseIncludeSpec('relationships'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    // solutions are hierarchy children, not relationship children
    expect(titles).not.toContain('Solution 1');
    expect(titles).not.toContain('Solution 2');
    // goal is hierarchy parent, not relationship parent
    expect(titles).not.toContain('Goal');
  });

  it('filters relationships by child type', () => {
    const result = expandInclude(
      [oppA],
      parseIncludeSpec('relationships(assumption)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Assumption 1');
  });

  it('filters relationships by parent:child type pair', () => {
    const result = expandInclude(
      [oppA],
      parseIncludeSpec('relationships(opportunity:assumption)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Assumption 1');
  });

  it('filters relationships by parent:field:child', () => {
    const result = expandInclude(
      [oppA],
      parseIncludeSpec('relationships(opportunity:assumptions:assumption)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Assumption 1');
  });

  it('excludes when field does not match', () => {
    const result = expandInclude(
      [oppA],
      parseIncludeSpec('relationships(opportunity:risks:assumption)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).not.toContain('Assumption 1');
  });
});

describe('expandInclude — multiple directives', () => {
  it('combines directives, deduplicating results', () => {
    const result = expandInclude(
      [sol1],
      parseIncludeSpec('ancestors(goal), siblings'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Solution 1'); // matched
    expect(titles).toContain('Goal'); // via ancestors(goal)
    expect(titles).toContain('Solution 2'); // via siblings
    expect(titles).not.toContain('Opportunity A'); // filtered out by ancestors(goal)
    // No duplicates
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('expandInclude — preserves matched nodes', () => {
  it('always includes matched nodes in result', () => {
    const result = expandInclude(
      [sol3],
      parseIncludeSpec('ancestors(goal)'),
      ctx.nodeIndex,
      ctx.childrenIndex,
      ctx.augmented,
    );
    const titles = result.map((n) => n.schemaData.title);
    expect(titles).toContain('Solution 3');
    expect(titles).toContain('Goal');
  });
});
