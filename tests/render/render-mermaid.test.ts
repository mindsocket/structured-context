import { describe, expect, it } from 'bun:test';
import { renderMermaid } from '../../src/plugins/markdown/render-mermaid';
import { buildSpaceGraph } from '../../src/space-graph';
import type { SpaceNode } from '../../src/types';
import { makeLevel, makeParentRef } from '../test-helpers';

const levels = [
  makeLevel('vision'),
  makeLevel('mission'),
  makeLevel('goal'),
  makeLevel('opportunity'),
  makeLevel('solution'),
];

function makeNode(title: string, type: string, status = 'active'): SpaceNode {
  return {
    label: `${title}.md`,
    title,
    schemaData: { title, type, status },
    linkTargets: [title],
    type,
    resolvedType: type,
    resolvedParents: [],
    resolvedLinks: [],
  };
}

describe('renderMermaid', () => {
  it('starts with graph TD', () => {
    const output = renderMermaid(buildSpaceGraph([], levels));
    expect(output.startsWith('graph TD\n')).toBe(true);
  });

  it('renders a root node with type_status class', () => {
    const goal = makeNode('My Goal', 'goal', 'active');
    const output = renderMermaid(buildSpaceGraph([goal], levels));
    expect(output).toContain('My_Goal["My Goal"]:::goal_active');
  });

  it('renders edges between parent and child', () => {
    const goal = makeNode('My Goal', 'goal', 'active');
    const opp = makeNode('An Opportunity', 'opportunity', 'active');
    opp.resolvedParents = [makeParentRef('My Goal')];
    const output = renderMermaid(buildSpaceGraph([goal, opp], levels));
    expect(output).toContain('My_Goal --> An_Opportunity');
  });

  it('wraps orphans in a subgraph', () => {
    const orphan = makeNode('Orphaned Opp', 'opportunity', 'active');
    const output = renderMermaid(buildSpaceGraph([orphan], levels));
    expect(output).toContain('subgraph Orphans');
    expect(output).toContain('Orphaned_Opp["Orphaned Opp"]:::opportunity_active');
  });

  it('escapes double quotes in node labels', () => {
    const node = makeNode('Say "Hello"', 'goal', 'active');
    const output = renderMermaid(buildSpaceGraph([node], levels));
    expect(output).toContain('&quot;Hello&quot;');
  });

  it('does not render non-hierarchy nodes', () => {
    const dashboard = makeNode('My Dashboard', 'dashboard', 'active');
    const output = renderMermaid(buildSpaceGraph([dashboard], levels));
    expect(output).not.toContain('My_Dashboard');
  });
});
