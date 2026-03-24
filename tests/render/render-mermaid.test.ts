import { describe, expect, it } from 'bun:test';
import { renderMermaid } from '../../src/plugins/markdown/render-mermaid';
import type { RenderInput } from '../../src/plugins/util';
import type { SpaceContext, SpaceNode } from '../../src/types';
import type { NodeClassification } from '../../src/util/graph-helpers';
import { makeParentRef } from '../test-helpers';

function makeNode(title: string, type: string, status = 'active'): SpaceNode {
  return {
    label: `${title}.md`,
    schemaData: { title, type, status },
    linkTargets: [title],
    type,
    resolvedType: type,
    resolvedParents: [],
  };
}

function makeInput(classification: NodeClassification, nodes?: SpaceNode[]): RenderInput {
  const allNodes = nodes ?? [
    ...new Map(
      [
        ...classification.hierarchyRoots,
        ...classification.orphans,
        ...classification.nonHierarchy,
        ...[...classification.children.values()].flat(),
      ].map((n) => [n.schemaData.title, n]),
    ).values(),
  ];
  return {
    nodes: allNodes,
    classification,
    context: {} as SpaceContext,
  };
}

describe('renderMermaid', () => {
  it('starts with graph TD', () => {
    const classification: NodeClassification = {
      hierarchyRoots: [],
      orphans: [],
      nonHierarchy: [],
      children: new Map(),
    };
    const output = renderMermaid(makeInput(classification));
    expect(output.startsWith('graph TD\n')).toBe(true);
  });

  it('renders a root node with type_status class', () => {
    const goal = makeNode('My Goal', 'goal', 'active');
    const classification: NodeClassification = {
      hierarchyRoots: [goal],
      orphans: [],
      nonHierarchy: [],
      children: new Map([['My Goal', []]]),
    };
    const output = renderMermaid(makeInput(classification));
    expect(output).toContain('My_Goal["My Goal"]:::goal_active');
  });

  it('renders edges between parent and child', () => {
    const goal = makeNode('My Goal', 'goal', 'active');
    const opp = makeNode('An Opportunity', 'opportunity', 'active');
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
    const output = renderMermaid(makeInput(classification));
    expect(output).toContain('My_Goal --> An_Opportunity');
  });

  it('wraps orphans in a subgraph', () => {
    const orphan = makeNode('Orphaned Opp', 'opportunity', 'active');
    const classification: NodeClassification = {
      hierarchyRoots: [],
      orphans: [orphan],
      nonHierarchy: [],
      children: new Map([['Orphaned Opp', []]]),
    };
    const output = renderMermaid(makeInput(classification));
    expect(output).toContain('subgraph Orphans');
    expect(output).toContain('Orphaned_Opp["Orphaned Opp"]:::opportunity_active');
  });

  it('escapes double quotes in node labels', () => {
    const node = makeNode('Say "Hello"', 'goal', 'active');
    const classification: NodeClassification = {
      hierarchyRoots: [node],
      orphans: [],
      nonHierarchy: [],
      children: new Map([['Say "Hello"', []]]),
    };
    const output = renderMermaid(makeInput(classification));
    expect(output).toContain('&quot;Hello&quot;');
  });

  it('does not render non-hierarchy nodes', () => {
    const dashboard = makeNode('My Dashboard', 'dashboard', 'active');
    const classification: NodeClassification = {
      hierarchyRoots: [],
      orphans: [],
      nonHierarchy: [dashboard],
      children: new Map(),
    };
    const output = renderMermaid(makeInput(classification));
    expect(output).not.toContain('My_Dashboard');
  });
});
