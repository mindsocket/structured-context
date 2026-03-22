import { describe, expect, it } from 'bun:test';
import { resolveGraphEdges } from '../../src/read/resolve-graph-edges';
import { validateGraph } from '../../src/schema/validate-graph';
import type { SchemaMetadata } from '../../src/types';
import { makeLevel, makeNode, makeRelationship } from '../test-helpers';

describe('validateGraph - Relationships', () => {
  const metadata: SchemaMetadata = {
    hierarchy: { levels: [makeLevel('opportunity')] },
    relationships: [makeRelationship('opportunity', 'assumption', { templateFormat: 'table' })],
  };

  it('passes when child linked to correct parent type', () => {
    const opp = makeNode('Opp 1', 'opportunity');
    const assumption = makeNode('Assumption 1', 'assumption', { parent: '[[Opp 1]]' });

    const nodes = [opp, assumption];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('fails when child linked to missing parent', () => {
    const assumption = makeNode('Assumption 1', 'assumption', { parent: '[[Missing Opp]]' });

    const nodes = [assumption];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0]?.error).toContain('not found');
  });

  it('fails (type mismatch) when child linked to node of incorrect type', () => {
    const someOtherNode = makeNode('Wrong Type Node', 'solution');
    const assumption = makeNode('Assumption 1', 'assumption', { parent: '[[Wrong Type Node]]' });

    const nodes = [someOtherNode, assumption];
    // resolveGraphEdges resolves permissively; validateFieldReferences catches the type mismatch
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    // Field validation catches it now
    expect(refErrors).toBeEmpty();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.description).toContain('expected opportunity');
  });

  it('skips child nodes with no parent field (no false errors)', () => {
    const assumption = makeNode('Assumption 1', 'assumption');

    const nodes = [assumption];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('uses custom field name when fieldOn is child', () => {
    const metaWithCustomField: SchemaMetadata = {
      hierarchy: { levels: [makeLevel('opportunity')] },
      relationships: [makeRelationship('opportunity', 'assumption', { field: 'linked_opportunity' })],
    };

    const opp = makeNode('Opp 1', 'opportunity');
    const assumption = makeNode('Assumption 1', 'assumption', { linked_opportunity: '[[Opp 1]]' });

    const nodes = [opp, assumption];
    const unresolvedRefs = resolveGraphEdges(nodes, metaWithCustomField);
    const { violations, refErrors } = validateGraph(nodes, metaWithCustomField, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('reports error for custom field pointing to wrong type', () => {
    const metaWithCustomField: SchemaMetadata = {
      hierarchy: { levels: [makeLevel('opportunity')] },
      relationships: [makeRelationship('opportunity', 'assumption', { field: 'linked_opportunity' })],
    };

    const solution = makeNode('Solution 1', 'solution');
    const assumption = makeNode('Assumption 1', 'assumption', { linked_opportunity: '[[Solution 1]]' });

    const nodes = [solution, assumption];
    const unresolvedRefs = resolveGraphEdges(nodes, metaWithCustomField);
    const { violations, refErrors } = validateGraph(nodes, metaWithCustomField, unresolvedRefs);

    expect(refErrors).toBeEmpty();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.description).toContain('expected opportunity');
  });
});

describe('validateGraph — fieldOn: parent', () => {
  const metadata: SchemaMetadata = {
    hierarchy: { levels: [makeLevel('activity')] },
    relationships: [makeRelationship('activity', 'task', { field: 'tasks', fieldOn: 'parent', multiple: true })],
  };

  it('passes when parent field array contains correct child types', () => {
    const task1 = makeNode('Task 1', 'task');
    const task2 = makeNode('Task 2', 'task');
    const activity = makeNode('Activity 1', 'activity', { tasks: ['[[Task 1]]', '[[Task 2]]'] });

    const nodes = [activity, task1, task2];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('fails when parent field array contains a missing link', () => {
    const activity = makeNode('Activity 1', 'activity', { tasks: ['[[Missing Task]]'] });

    const nodes = [activity];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0]?.error).toContain('not found');
  });

  it('fails (type mismatch) when parent field array entry is wrong type', () => {
    const wrong = makeNode('Some Solution', 'solution');
    const activity = makeNode('Activity 1', 'activity', { tasks: ['[[Some Solution]]'] });

    const nodes = [activity, wrong];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(refErrors).toBeEmpty();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.description).toContain('expected task');
  });

  it('skips parent nodes with no field value (no false errors)', () => {
    const activity = makeNode('Activity 1', 'activity');

    const nodes = [activity];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toBeEmpty();
  });

  it('reports error when field is not an array', () => {
    const activity = makeNode('Activity 1', 'activity', { tasks: '[[Task 1]]' });

    const nodes = [activity];
    const unresolvedRefs = resolveGraphEdges(nodes, metadata);
    const { violations, refErrors } = validateGraph(nodes, metadata, unresolvedRefs);

    expect(violations).toBeEmpty();
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0]?.error).toContain('must be an array');
  });
});
