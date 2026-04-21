import { describe, expect, it } from 'bun:test';
import { renderBullets } from '../../src/plugins/markdown/render-bullets';
import { buildSpaceGraph } from '../../src/space-graph';
import type { SpaceNode } from '../../src/types';
import { makeLevel, makeParentRef } from '../test-helpers';

const levels = [makeLevel('goal'), makeLevel('opportunity'), makeLevel('solution')];

function makeNode(title: string, type: string): SpaceNode {
  return {
    label: `${title}.md`,
    title,
    schemaData: { title, type },
    linkTargets: [title],
    type,
    resolvedType: type,
    resolvedParents: [],
    resolvedLinks: [],
  };
}

describe('renderBullets', () => {
  it('renders a single root with no children', () => {
    const root = makeNode('My Goal', 'goal');
    const output = renderBullets(buildSpaceGraph([root], levels));
    expect(output).toBe('- goal: My Goal');
  });

  it('renders a tree with parent-child hierarchy', () => {
    const goal = makeNode('My Goal', 'goal');
    const opp = makeNode('An Opportunity', 'opportunity');
    opp.resolvedParents = [makeParentRef('My Goal')];
    const output = renderBullets(buildSpaceGraph([goal, opp], levels));
    expect(output).toBe('- goal: My Goal\n  - opportunity: An Opportunity');
  });

  it('renders orphans in a separate section', () => {
    const orphan = makeNode('Orphaned Opp', 'opportunity');
    const output = renderBullets(buildSpaceGraph([orphan], levels));
    expect(output).toContain('Orphans (missing parent):');
    expect(output).toContain('- opportunity: Orphaned Opp');
  });

  it('renders non-hierarchy nodes in a separate section', () => {
    const dashboard = makeNode('My Dashboard', 'dashboard');
    const output = renderBullets(buildSpaceGraph([dashboard], levels));
    expect(output).toContain('Other (not in hierarchy):');
    expect(output).toContain('- dashboard: My Dashboard');
  });

  it('marks repeated subtrees with (*) when the repeated node has children', () => {
    const goal = makeNode('My Goal', 'goal');
    const goal2 = makeNode('Another Goal', 'goal');
    const opp = makeNode('Shared Opp', 'opportunity');
    const solution = makeNode('A Solution', 'solution');
    // opp is referenced under both goals and has a child
    opp.resolvedParents = [makeParentRef('My Goal'), makeParentRef('Another Goal')];
    solution.resolvedParents = [makeParentRef('Shared Opp')];
    const output = renderBullets(buildSpaceGraph([goal, goal2, opp, solution], levels));
    expect(output).toContain('- opportunity: Shared Opp\n    - solution: A Solution');
    expect(output).toContain('- opportunity: Shared Opp (*)');
  });

  it('silently skips leaf nodes seen twice (no (*) marker)', () => {
    const goal = makeNode('My Goal', 'goal');
    const goal2 = makeNode('Another Goal', 'goal');
    const opp = makeNode('Shared Opp', 'opportunity');
    opp.resolvedParents = [makeParentRef('My Goal'), makeParentRef('Another Goal')];
    const output = renderBullets(buildSpaceGraph([goal, goal2, opp], levels));
    expect(output).toContain('- opportunity: Shared Opp');
    expect(output).not.toContain('(*)');
  });
});
