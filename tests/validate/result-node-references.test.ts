import { describe, expect, it } from 'bun:test';
import type { NodeId, SpaceNode, UnresolvedRef, ValidationIssue } from '../../src/types';
import { findDuplicateIds } from '../../src/validate';
import { validateGraph } from '../../src/validate/validate-graph';

// A result entry names its node by `nodeId` and, separately, where it is defined by `source`,
// so a consumer indexing a SpaceGraph by node id never has to guess what a `file` field holds.
describe('result entries separate node id from source location', () => {
  const id = 'okr-1' as NodeId;
  const ref: UnresolvedRef = {
    id,
    ref: 'missing',
    field: 'parent',
    reason: 'not_found',
    message: 'not found',
    source: { file: 'goals/okr-1.md', line: 3 },
  };

  it('broken-link issues carry the node id and the source location', () => {
    const [issue] = validateGraph([], { hierarchies: [] } as never, [ref]);
    expect(issue?.nodeId).toBe(id);
    expect(issue?.source).toEqual({ file: 'goals/okr-1.md', line: 3 });
  });

  it('broken-link issues for a node without a source carry only the node id', () => {
    const [issue] = validateGraph([], { hierarchies: [] } as never, [{ ...ref, source: undefined }]);
    expect(issue?.nodeId).toBe(id);
    expect('source' in issue!).toBe(false);
  });
});

describe('findDuplicateIds', () => {
  const node = (id: string, source?: SpaceNode['source']) => ({ id: id as NodeId, source }) as SpaceNode;
  type DuplicateIssue = Extract<ValidationIssue, { kind: 'duplicate' }>;

  it('lists where each node sharing an id is defined', () => {
    const dupes = findDuplicateIds([
      node('a', { file: 'x.md', line: 1 }),
      node('a', { file: 'y.md', line: 4 }),
      node('b', { file: 'z.md' }),
    ]);
    expect(dupes).toEqual([
      {
        kind: 'duplicate',
        key: 'duplicate:a',
        severity: 'error',
        message: expect.stringContaining('used by 2 nodes'),
        nodeId: 'a' as NodeId,
        sources: [
          { file: 'x.md', line: 1 },
          { file: 'y.md', line: 4 },
        ],
      } as DuplicateIssue,
    ]);
  });

  it('reports no sources for nodes without a source location', () => {
    expect(findDuplicateIds([node('a'), node('a')])).toEqual([
      expect.objectContaining({ nodeId: 'a' as NodeId, sources: [] }) as unknown as DuplicateIssue,
    ]);
  });
});
