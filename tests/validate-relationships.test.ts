import { describe, expect, it } from 'bun:test';
import type { SchemaMetadata, SpaceNode } from '../src/types';
import { validateRelationships } from '../src/validate-hierarchy';
import { buildTargetIndex } from '../src/wikilink-utils';

function makeNode(title: string, type: string, extra: Record<string, unknown> = {}, linkTargets?: string[]): SpaceNode {
  return {
    label: `${title}.md`,
    schemaData: { title, type, ...extra },
    linkTargets: linkTargets ?? [title],
    resolvedParents: [],
    resolvedType: type,
  };
}

describe('validateRelationships', () => {
  const metadata = {
    hierarchy: { levels: [{ type: 'opportunity' }] },
    relationships: [
      {
        parent: 'opportunity',
        type: 'assumption',
        format: 'table',
      },
    ],
  } as SchemaMetadata;

  it('passes when child linked to correct parent type', () => {
    const opp = makeNode('Opp 1', 'opportunity');
    const assumption = makeNode('Assumption 1', 'assumption', { parent: '[[Opp 1]]' });

    const nodes = [opp, assumption];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('fails when child linked to missing parent', () => {
    const assumption = makeNode('Assumption 1', 'assumption', { parent: '[[Missing Opp]]' });

    const nodes = [assumption];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0]?.error).toContain('not found');
  });

  it('fails (type mismatch) when child linked to node of incorrect type', () => {
    const someOtherNode = makeNode('Wrong Type Node', 'solution');
    const assumption = makeNode('Assumption 1', 'assumption', { parent: '[[Wrong Type Node]]' });

    const nodes = [someOtherNode, assumption];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(refErrors).toBeEmpty();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.description).toContain('expected opportunity');
  });

  it('skips child nodes with no parent field (no false errors)', () => {
    const assumption = makeNode('Assumption 1', 'assumption');

    const nodes = [assumption];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('uses custom field name when fieldOn is child', () => {
    const metaWithCustomField = {
      hierarchy: { levels: [{ type: 'opportunity' }] },
      relationships: [
        {
          parent: 'opportunity',
          type: 'assumption',
          field: 'linked_opportunity',
          fieldOn: 'child',
        },
      ],
    } as SchemaMetadata;

    const opp = makeNode('Opp 1', 'opportunity');
    const assumption = makeNode('Assumption 1', 'assumption', { linked_opportunity: '[[Opp 1]]' });

    const nodes = [opp, assumption];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metaWithCustomField, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('reports error for custom field pointing to wrong type', () => {
    const metaWithCustomField = {
      hierarchy: { levels: [{ type: 'opportunity' }] },
      relationships: [
        {
          parent: 'opportunity',
          type: 'assumption',
          field: 'linked_opportunity',
          fieldOn: 'child',
        },
      ],
    } as SchemaMetadata;

    const solution = makeNode('Solution 1', 'solution');
    const assumption = makeNode('Assumption 1', 'assumption', { linked_opportunity: '[[Solution 1]]' });

    const nodes = [solution, assumption];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metaWithCustomField, index);

    expect(refErrors).toBeEmpty();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.description).toContain('expected opportunity');
  });
});

describe('validateRelationships — fieldOn: parent', () => {
  const metadata = {
    hierarchy: { levels: [{ type: 'activity' }] },
    relationships: [
      {
        parent: 'activity',
        type: 'task',
        field: 'tasks',
        fieldOn: 'parent',
        multi: true,
      },
    ],
  } as SchemaMetadata;

  it('passes when parent field array contains correct child types', () => {
    const task1 = makeNode('Task 1', 'task');
    const task2 = makeNode('Task 2', 'task');
    const activity = makeNode('Activity 1', 'activity', { tasks: ['[[Task 1]]', '[[Task 2]]'] });

    const nodes = [activity, task1, task2];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('fails when parent field array contains a missing link', () => {
    const activity = makeNode('Activity 1', 'activity', { tasks: ['[[Missing Task]]'] });

    const nodes = [activity];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0]?.error).toContain('not found');
  });

  it('fails (type mismatch) when parent field array entry is wrong type', () => {
    const wrong = makeNode('Some Solution', 'solution');
    const activity = makeNode('Activity 1', 'activity', { tasks: ['[[Some Solution]]'] });

    const nodes = [activity, wrong];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(refErrors).toBeEmpty();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.description).toContain('expected task');
  });

  it('skips parent nodes with no field value (no false errors)', () => {
    const activity = makeNode('Activity 1', 'activity');

    const nodes = [activity];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('reports error when field is not an array', () => {
    const activity = makeNode('Activity 1', 'activity', { tasks: '[[Task 1]]' });

    const nodes = [activity];
    const index = buildTargetIndex(nodes);

    const { violations, refErrors } = validateRelationships(nodes, metadata, index);

    expect(violations).toBeEmpty();
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0]?.error).toContain('must be an array');
  });
});
