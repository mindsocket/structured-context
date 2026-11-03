import { describe, expect, it } from 'bun:test';
import { validateGraph } from '../../src/schema/validate-graph';
import type { NodeId, SpaceNode, UnresolvedRef } from '../../src/types';
import { findDuplicateIds } from '../../src/validate';

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

  it('refErrors carry the node id and the source location', () => {
    const { refErrors } = validateGraph([], { hierarchies: [] } as never, [ref]);
    expect(refErrors[0]!.nodeId).toBe(id);
    expect(refErrors[0]!.source).toEqual({ file: 'goals/okr-1.md', line: 3 });
  });

  it('refErrors for a node without a source carry only the node id', () => {
    const { refErrors } = validateGraph([], { hierarchies: [] } as never, [{ ...ref, source: undefined }]);
    expect(refErrors[0]!.nodeId).toBe(id);
    expect('source' in refErrors[0]!).toBe(false);
  });
});

describe('findDuplicateIds', () => {
  const node = (id: string, source?: SpaceNode['source']) => ({ id: id as NodeId, source }) as SpaceNode;

  it('lists where each node sharing an id is defined', () => {
    const dupes = findDuplicateIds([
      node('a', { file: 'x.md', line: 1 }),
      node('a', { file: 'y.md', line: 4 }),
      node('b', { file: 'z.md' }),
    ]);
    expect(dupes).toEqual([
      {
        id: 'a' as NodeId,
        sources: [
          { file: 'x.md', line: 1 },
          { file: 'y.md', line: 4 },
        ],
      },
    ]);
  });

  it('reports no sources for nodes without a source location', () => {
    expect(findDuplicateIds([node('a'), node('a')])).toEqual([{ id: 'a' as NodeId, sources: [] }]);
  });
});
