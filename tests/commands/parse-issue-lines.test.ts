import { describe, expect, it } from 'bun:test';
import { parseIssueLines } from '../../src/commands/validate';
import type { ParseIssue } from '../../src/types';

const untyped = (n: number): ParseIssue[] =>
  Array.from({ length: n }, (_, i) => ({ file: `n${i}.md`, severity: 'warning', type: 'no-type', line: 1 }));

describe('parseIssueLines', () => {
  it('lists a few notes of a kind and counts the rest', () => {
    const lines = parseIssueLines(untyped(353), false);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('   n0.md:1: warning - no-type');
    expect(lines[5]).toBe('   ... and 348 more warning - no-type (--verbose lists all)');
  });

  it('lists every note with all set', () => {
    expect(parseIssueLines(untyped(12), true)).toHaveLength(12);
  });

  it('lists a kind at the limit in full, without a count line', () => {
    expect(parseIssueLines(untyped(5), false)).toHaveLength(5);
  });

  it('keeps kinds apart and always lists errors', () => {
    const errors: ParseIssue[] = Array.from({ length: 8 }, (_, i) => ({
      file: `bad${i}.md`,
      severity: 'error',
      type: 'parse',
      line: 3,
      message: 'bad yaml',
    }));
    const lines = parseIssueLines([...untyped(7), ...errors], false);
    expect(lines.filter((l) => l.includes('error - parse - bad yaml'))).toHaveLength(8);
    expect(lines).toContain('   ... and 2 more warning - no-type (--verbose lists all)');
    expect(lines).toContain('   ... and 2 more warning - no-type (--verbose lists all)');
    expect(lines.filter((l) => l.includes('warning - no-type'))).toHaveLength(6);
  });
});
