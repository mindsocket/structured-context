import { describe, expect, it } from 'bun:test';
import type { NodeId } from '../../src/types';
import { nodeIssues } from '../../src/validate';

const id = (value: string) => value as NodeId;

const empty = {
  nodeErrors: [],
  refErrors: [],
  duplicateErrors: [],
  hierarchyViolations: [],
  ruleViolations: [],
  coverageGates: [],
  unresolvedContentLinks: [],
};

describe('nodeIssues', () => {
  it('gathers each kind of result by node, with its severity', () => {
    const issues = nodeIssues({
      ...empty,
      nodeErrors: [
        { nodeId: id('a.md'), source: { file: 'a.md', line: 3 }, issues: [{ message: 'bad', dedupeKey: 'k' }] },
      ],
      refErrors: [{ nodeId: id('a.md'), parent: '[[Gone]]', error: 'not found' }],
      hierarchyViolations: [{ nodeId: id('b.md'), description: 'wrong parent' } as never],
      ruleViolations: [
        { nodeId: id('b.md'), ruleId: 'r1', severity: 'warning', description: 'soft' } as never,
        { ruleId: 'global', severity: 'error', description: 'no node' } as never,
      ],
      unresolvedContentLinks: [{ nodeId: id('b.md'), target: 'Missing', severity: 'info' }],
    });

    expect(issues['a.md']).toEqual({
      'schema:k': { kind: 'schema', message: 'bad', severity: 'error', line: 3 },
      'broken-link:[[Gone]]': { kind: 'broken-link', message: '[[Gone]] → not found', severity: 'error' },
    });
    expect(Object.fromEntries(Object.entries(issues['b.md']!).map(([key, { severity }]) => [key, severity]))).toEqual({
      'hierarchy:wrong parent': 'error',
      'rule:r1': 'warning',
      'content-link:Missing': 'info',
    });
    expect(Object.keys(issues)).toEqual(['a.md', 'b.md']);
  });

  it('notes each gated node at info, worded by includeGated', () => {
    const gated = {
      ...empty,
      coverageGates: [{ nodeId: id('a.md'), reason: 'schema', gatedNodeIds: [id('a.md'), id('c.md')] } as never],
    };
    expect(nodeIssues(gated)['c.md']?.['gated:a.md']).toMatchObject({ severity: 'info', kind: 'gated' });
    expect(nodeIssues(gated)['c.md']?.['gated:a.md']?.message).toContain('not evaluated');
    expect(nodeIssues(gated, { includeGated: true })['c.md']?.['gated:a.md']?.message).toContain('evaluated anyway');
  });
});
