import { describe, expect, it } from 'bun:test';
import { renderBullets } from '../../src/plugins/markdown/render-bullets';
import type { RenderInput } from '../../src/plugins/util';
import type { NodeClassification } from '../../src/util/graph-helpers';
import type { SpaceContext, SpaceNode } from '../../src/types';
import { makeParentRef } from '../test-helpers';

function makeNode(title: string, type: string): SpaceNode {
  return {
    label: `${title}.md`,
    schemaData: { title, type },
    linkTargets: [title],
    type,
    resolvedType: type,
    resolvedParents: [],
  };
}

function makeInput(classification: NodeClassification): RenderInput {
  const allNodes = [
    ...classification.hierarchyRoots,
    ...classification.orphans,
    ...classification.nonHierarchy,
    ...[...classification.children.values()].flat(),
  ];
  return {
    nodes: [...new Map(allNodes.map((n) => [n.schemaData.title, n])).values()],
    classification,
    context: {} as SpaceContext,
  };
}

describe('renderBullets', () => {
  it('renders a single root with no children', () => {
    const root = makeNode('My Goal', 'goal');
    const classification: NodeClassification = {
      hierarchyRoots: [root],
      orphans: [],
      nonHierarchy: [],
      children: new Map([['My Goal', []]]),
    };
    const output = renderBullets(makeInput(classification));
    expect(output).toBe('- goal: My Goal');
  });

  it('renders a tree with parent-child hierarchy', () => {
    const goal = makeNode('My Goal', 'goal');
    const opp = makeNode('An Opportunity', 'opportunity');
    opp.resolvedParents = [makeParentRef('My Goal')];
    const classification: NodeClassification = {
      hierarchyRoots: [goal],
      orphans: [],
      nonHierarchy: [],
      children: new Map([
        ['My Goal', [opp]],
        ['An Opportunity', []],
      ]),
    };
    const output = renderBullets(makeInput(classification));
    expect(output).toBe('- goal: My Goal\n  - opportunity: An Opportunity');
  });

  it('renders orphans in a separate section', () => {
    const orphan = makeNode('Orphaned Opp', 'opportunity');
    const classification: NodeClassification = {
      hierarchyRoots: [],
      orphans: [orphan],
      nonHierarchy: [],
      children: new Map([['Orphaned Opp', []]]),
    };
    const output = renderBullets(makeInput(classification));
    expect(output).toContain('Orphans (missing parent):');
    expect(output).toContain('- opportunity: Orphaned Opp');
  });

  it('renders non-hierarchy nodes in a separate section', () => {
    const dashboard = makeNode('My Dashboard', 'dashboard');
    const classification: NodeClassification = {
      hierarchyRoots: [],
      orphans: [],
      nonHierarchy: [dashboard],
      children: new Map(),
    };
    const output = renderBullets(makeInput(classification));
    expect(output).toContain('Other (not in hierarchy):');
    expect(output).toContain('- dashboard: My Dashboard');
  });

  it('marks repeated subtrees with (*) when the repeated node has children', () => {
    const goal = makeNode('My Goal', 'goal');
    const goal2 = makeNode('Another Goal', 'goal');
    const opp = makeNode('Shared Opp', 'opportunity');
    const solution = makeNode('A Solution', 'solution');
    // opp is referenced under both goals and has a child
    const classification: NodeClassification = {
      hierarchyRoots: [goal, goal2],
      orphans: [],
      nonHierarchy: [],
      children: new Map([
        ['My Goal', [opp]],
        ['Another Goal', [opp]],
        ['Shared Opp', [solution]],
        ['A Solution', []],
      ]),
    };
    const output = renderBullets(makeInput(classification));
    expect(output).toContain('- opportunity: Shared Opp\n    - solution: A Solution');
    expect(output).toContain('- opportunity: Shared Opp (*)');
  });

  it('silently skips leaf nodes seen twice (no (*) marker)', () => {
    const goal = makeNode('My Goal', 'goal');
    const goal2 = makeNode('Another Goal', 'goal');
    const opp = makeNode('Shared Opp', 'opportunity');
    const classification: NodeClassification = {
      hierarchyRoots: [goal, goal2],
      orphans: [],
      nonHierarchy: [],
      children: new Map([
        ['My Goal', [opp]],
        ['Another Goal', [opp]],
        ['Shared Opp', []],
      ]),
    };
    const output = renderBullets(makeInput(classification));
    expect(output).toContain('- opportunity: Shared Opp');
    expect(output).not.toContain('(*)');
  });
});
