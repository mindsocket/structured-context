import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { bundledSchemasDir, createValidator } from '../../src/schema/schema';
import { validateSpace } from '../../src/validate';
import { makeSpaceContext } from '../helpers/context';

const OKF_SCHEMA_PATH = join(bundledSchemasDir, 'okf.json');
const BUNDLE_DIR = join(import.meta.dir, '../fixtures/okf/bundle');
const RULE_VIOLATIONS_DIR = join(import.meta.dir, '../fixtures/okf/rule-violations');

const validateNode = createValidator(OKF_SCHEMA_PATH);
const ts = '2026-06-20T22:53:05Z';
const valid = (data: Record<string, unknown>) => validateNode({ title: 't', ...data });

describe('OKF schema', () => {
  it('accepts a concept carrying only `type`, with any type value', () => {
    expect(valid({ type: 'Reference' })).toBe(true);
    expect(valid({ type: 'Something Nobody Registered' })).toBe(true);
  });

  it('requires `type`', () => {
    expect(valid({})).toBe(false);
  });

  it('tolerates unknown extension keys', () => {
    expect(valid({ type: 'Metric', vendor: { nested: [1, 2] } })).toBe(true);
  });

  it('accepts provenance, trust and lifecycle families', () => {
    expect(
      valid({
        type: 'Metric',
        description: 'd',
        resource: 'https://example.com/x',
        tags: ['a'],
        sources: [
          { resource: 'all queries in project X', usage_count: 3, last_modified: ts, author: 'team:docs' },
          { id: 'a', resource: '/references/a.md' },
        ],
        usage_window: { from: ts, to: '2026-07-01T00:00:00+10:00' },
        generated: { by: 'agent/1', at: ts },
        verified: [{ by: 'human:a', at: ts }],
        status: 'draft',
        stale_after: '2026-09-23T00:00:00Z',
      }),
    ).toBe(true);
  });

  it('accepts `verified` as a bare mapping', () => {
    expect(valid({ type: 'Metric', verified: { by: 'human:a', at: ts } })).toBe(true);
  });

  it.each([
    ['date-only timestamp', { generated: { by: 'a/1', at: '2026-06-20' } }],
    ['timestamp without offset', { stale_after: '2026-09-23T00:00:00' }],
    ['unknown status', { status: 'archived' }],
    ['source without resource', { sources: [{ id: 'a' }] }],
    ['generated without by', { generated: { at: ts } }],
    ['verified without at', { verified: { by: 'human:a' } }],
    ['non-list tags', { tags: 'a' }],
  ])('rejects %s', (_name, extra) => {
    expect(valid({ type: 'Metric', ...extra })).toBe(false);
  });

  it('requires runtime on Attested Computation and validates its contract fields', () => {
    const ac = { type: 'Attested Computation', runtime: 'bigquery' };
    expect(valid(ac)).toBe(true);
    expect(valid({ type: 'Attested Computation' })).toBe(false);
    expect(valid({ ...ac, parameters: [{ name: 'year', type: 'integer', required: true }] })).toBe(true);
    expect(valid({ ...ac, parameters: [{ type: 'integer' }] })).toBe(false);
    expect(valid({ ...ac, executor: { resource: 'r.md', receipt: ['job_id'] }, attester: { resource: 'a.py' } })).toBe(
      true,
    );
    expect(valid({ ...ac, executor: { receipt: ['job_id'] } })).toBe(false);
    expect(valid({ ...ac, attester: {} })).toBe(false);
  });
});

describe('OKF bundle validation', () => {
  it('validates the sample bundle as a markdown space, excluding the reserved index.md and log.md', async () => {
    const result = await validateSpace(makeSpaceContext(BUNDLE_DIR, OKF_SCHEMA_PATH));
    expect(result.nodeErrors).toEqual([]);
    expect(result.validCount).toBe(4);
    expect(result.parseIssues.map((i) => i.file).sort()).toEqual(['index.md', 'log.md']);
    // playbooks/bare.md has only `type`: the description best-practice rule is the sole finding
    expect(result.ruleViolations.map((v) => [v.file, v.ruleId])).toEqual([['playbooks/bare.md', 'okf-description']]);
  });

  it('flags coherence and contract rule violations', async () => {
    const result = await validateSpace(makeSpaceContext(RULE_VIOLATIONS_DIR, OKF_SCHEMA_PATH));
    expect(result.nodeErrors).toEqual([]);
    expect(result.ruleViolations.map((v) => `${v.file}:${v.ruleId}`).sort()).toEqual([
      'no-computation.md:okf-computation-present',
      'stale-before-generated.md:okf-stale-after-generated',
      'usage-without-window.md:okf-usage-count-window',
    ]);
  });
});
