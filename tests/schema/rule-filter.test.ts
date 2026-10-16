import { describe, expect, it } from 'bun:test';
import { filterRules, parseRuleFilter } from '../../src/schema/rule-filter';
import type { Rule } from '../../src/types';

const rules: Rule[] = [
  { id: 'a', category: 'validation', description: 'a', expression: 'true', type: 'goal' },
  { id: 'b', category: 'best-practice', description: 'b', semantic: {}, type: 'opportunity' },
  { id: 'c', category: 'coherence', description: 'c', expression: 'true', severity: 'error' },
];
const ids = (r: Rule[]) => r.map((x) => x.id);

describe('rule filter', () => {
  it('parses repeated specs and merges values per dimension', () => {
    expect(parseRuleFilter(['type=goal', 'category=coherence,validation', 'category=workflow'])).toEqual({
      type: ['goal'],
      category: ['coherence', 'validation', 'workflow'],
    });
  });

  it('rejects malformed specs and unknown dimensions', () => {
    expect(() => parseRuleFilter(['semantic'])).toThrow('Invalid rule filter');
    expect(() => parseRuleFilter(['colour=red'])).toThrow('Invalid rule filter');
    expect(() => parseRuleFilter(['mode=semantic'])).toThrow('Invalid rule filter');
    expect(() => parseRuleFilter(['type='])).toThrow('Invalid rule filter');
  });

  it('filters by severity (effective), category, type and id', () => {
    expect(ids(filterRules(rules, { severity: ['error'] }))).toEqual(['a', 'c']);
    expect(ids(filterRules(rules, { category: ['coherence'] }))).toEqual(['c']);
    expect(ids(filterRules(rules, { type: ['goal', 'opportunity'] }))).toEqual(['a', 'b']);
    expect(ids(filterRules(rules, { id: ['c'] }))).toEqual(['c']);
  });

  it('ANDs dimensions and treats an undefined filter as everything', () => {
    expect(ids(filterRules(rules, { severity: ['error'], type: ['opportunity'] }))).toEqual([]);
    expect(filterRules(rules, undefined)).toBe(rules);
  });
});
