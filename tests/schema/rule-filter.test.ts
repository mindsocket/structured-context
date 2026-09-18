import { describe, expect, it } from 'bun:test';
import { filterRules, parseRuleFilter } from '../../src/schema/rule-filter';
import type { Rule } from '../../src/types';

const rules: Rule[] = [
  { id: 'a', category: 'validation', description: 'a', check: 'true', type: 'goal' },
  { id: 'b', category: 'best-practice', description: 'b', mode: 'semantic', type: 'opportunity' },
  { id: 'c', category: 'coherence', description: 'c', check: 'true', severity: 'error' },
];
const ids = (r: Rule[]) => r.map((x) => x.id);

describe('rule filter', () => {
  it('parses repeated specs and merges values per dimension', () => {
    expect(parseRuleFilter(['mode=semantic', 'category=coherence,validation', 'category=workflow'])).toEqual({
      mode: ['semantic'],
      category: ['coherence', 'validation', 'workflow'],
    });
  });

  it('rejects malformed specs and unknown dimensions', () => {
    expect(() => parseRuleFilter(['semantic'])).toThrow('Invalid rule filter');
    expect(() => parseRuleFilter(['colour=red'])).toThrow('Invalid rule filter');
    expect(() => parseRuleFilter(['mode='])).toThrow('Invalid rule filter');
  });

  it('filters by mode (defaulting to expression), severity (effective), category, type and id', () => {
    expect(ids(filterRules(rules, { mode: ['semantic'] }))).toEqual(['b']);
    expect(ids(filterRules(rules, { mode: ['expression'] }))).toEqual(['a', 'c']);
    expect(ids(filterRules(rules, { severity: ['error'] }))).toEqual(['a', 'c']);
    expect(ids(filterRules(rules, { category: ['coherence'] }))).toEqual(['c']);
    expect(ids(filterRules(rules, { type: ['goal', 'opportunity'] }))).toEqual(['a', 'b']);
    expect(ids(filterRules(rules, { id: ['c'] }))).toEqual(['c']);
  });

  it('ANDs dimensions and treats an undefined filter as everything', () => {
    expect(ids(filterRules(rules, { severity: ['error'], mode: ['semantic'] }))).toEqual([]);
    expect(filterRules(rules, undefined)).toBe(rules);
  });
});
