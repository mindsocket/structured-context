import { describe, expect, it } from 'bun:test';
import type { NodeId, SpaceNode } from '../../src/types';
import { issuesOf, type SpaceValidationResult } from '../../src/validate';

const id = (value: string) => value as NodeId;

const empty: SpaceValidationResult = {
  validCount: 0,
  nodeFailures: [],
  refErrors: [],
  duplicateErrors: [],
  ruleViolations: [],
  hierarchyViolations: [],
  orphans: [],
  unresolvedContentLinks: [],
  coverageGates: [],
  contextTrimmed: { nodeCount: 0, ruleIds: [] },
};

const summary = (issues: ReturnType<typeof issuesOf>) =>
  issues.map(({ kind, key, severity, nodeId }) => ({ kind, key, severity, nodeId }));

describe('issuesOf', () => {
  it('gives every finding a kind, a key and a severity', () => {
    const node = { id: id('a.md'), source: { file: 'a.md', line: 3 } } as SpaceNode;
    const issues = issuesOf(
      {
        ...empty,
        nodeFailures: [{ node, issues: [{ message: 'bad', dedupeKey: 'k' }] }],
        refErrors: [{ nodeId: id('a.md'), parent: '[[Gone]]', error: 'not found' }],
        hierarchyViolations: [{ nodeId: id('b.md'), description: 'wrong parent' } as never],
        ruleViolations: [
          { nodeId: id('b.md'), ruleId: 'r1', category: 'coherence', severity: 'warning', description: 'soft' },
          { ruleId: 'global', category: 'validation', severity: 'error', description: 'no node' },
        ],
        unresolvedContentLinks: [{ nodeId: id('b.md'), target: 'Missing' }],
      },
      [{ source: { file: 'x.md', line: 1 }, severity: 'warning', type: 'no-type' }],
      {},
    );

    expect(summary(issues)).toEqual([
      { kind: 'parse', key: 'parse:no-type', severity: 'warning', nodeId: undefined },
      { kind: 'schema', key: 'schema:k', severity: 'error', nodeId: id('a.md') },
      { kind: 'broken-link', key: 'broken-link:[[Gone]]', severity: 'error', nodeId: id('a.md') },
      { kind: 'hierarchy', key: 'hierarchy:wrong parent', severity: 'error', nodeId: id('b.md') },
      { kind: 'rule', key: 'rule:r1', severity: 'warning', nodeId: id('b.md') },
      { kind: 'rule', key: 'rule:global', severity: 'error', nodeId: undefined },
      { kind: 'content-link', key: 'content-link:Missing', severity: 'info', nodeId: id('b.md') },
    ]);
    expect(issues[0]).toMatchObject({ source: { file: 'x.md', line: 1 }, type: 'no-type' });
    expect(issues[1]).toMatchObject({ message: 'bad', source: { file: 'a.md', line: 3 } });
    expect(issues[2]).toMatchObject({ message: '[[Gone]] → not found', ref: '[[Gone]]', reason: 'not found' });
  });

  it('keeps an issue repeated on the same node once', () => {
    const v = { nodeId: id('a.md'), ruleId: 'r', category: 'coherence', severity: 'error', description: 'd' } as const;
    expect(issuesOf({ ...empty, ruleViolations: [v, v] }, [], {})).toHaveLength(1);
  });

  it('notes each gated node at info, worded by includeGated', () => {
    const gated = {
      ...empty,
      coverageGates: [{ nodeId: id('a.md'), reason: 'schema' as const, gatedNodeIds: [id('a.md'), id('c.md')] }],
    };
    const issue = issuesOf(gated, [], {}).find((one) => one.nodeId === 'c.md');
    expect(issue).toMatchObject({ kind: 'gated', key: 'gated:a.md', severity: 'info', gatedBy: 'a.md' });
    expect(issue?.message).toContain('not evaluated');
    expect(issuesOf(gated, [], { includeGated: true })[0]?.message).toContain('evaluated anyway');
  });
});
