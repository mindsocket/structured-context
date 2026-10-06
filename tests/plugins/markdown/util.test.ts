import { describe, expect, it } from 'bun:test';
import matter from 'gray-matter';
import { dumpYaml, MATTER_OPTIONS, parseYaml } from '../../../src/plugins/markdown/util';

describe('parseYaml', () => {
  it('keeps dates and datetimes as the strings written, at any depth', () => {
    const result = parseYaml(
      [
        'date: 2026-03-31',
        'at: 2026-06-20T22:53:05Z',
        'local: 2026-07-01T00:00:00+10:00',
        'meta: { created: 2025-01-01 }',
        'items: [2025-01-01, { at: 2025-02-01T09:00:00Z }]',
      ].join('\n'),
    );
    expect(result).toEqual({
      date: '2026-03-31',
      at: '2026-06-20T22:53:05Z',
      local: '2026-07-01T00:00:00+10:00',
      meta: { created: '2025-01-01' },
      items: ['2025-01-01', { at: '2025-02-01T09:00:00Z' }],
    });
  });

  it('still resolves numbers, booleans, nulls and merge keys', () => {
    const result = parseYaml('base: &b { x: 1 }\nm: { <<: *b, y: true }\nn: ~\nf: 1.5');
    expect(result).toEqual({ base: { x: 1 }, m: { x: 1, y: true }, n: null, f: 1.5 });
  });
});

describe('dumpYaml', () => {
  it('round-trips date strings unquoted', () => {
    const yaml = dumpYaml({ date: '2026-03-31', at: '2026-06-20T22:53:05Z' });
    expect(yaml).toBe('date: 2026-03-31\nat: 2026-06-20T22:53:05Z\n');
    expect(parseYaml(yaml)).toEqual({ date: '2026-03-31', at: '2026-06-20T22:53:05Z' });
  });
});

describe('MATTER_OPTIONS', () => {
  it('parses frontmatter timestamps as strings', () => {
    const { data } = matter('---\ngenerated: { at: 2026-06-20T22:53:05Z }\n---\nbody', MATTER_OPTIONS);
    expect(data).toEqual({ generated: { at: '2026-06-20T22:53:05Z' } });
  });
});
