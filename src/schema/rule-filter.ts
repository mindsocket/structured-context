import type { Rule } from '../types';
import { ruleSeverities } from './rule-severity';

export const RULE_FILTER_DIMENSIONS = ['mode', 'category', 'severity', 'type', 'id'] as const;
export type RuleFilterDimension = (typeof RULE_FILTER_DIMENSIONS)[number];

/** Narrows which rules are evaluated. Dimensions combine with AND; values within a dimension with OR. */
export type RuleFilter = Partial<Record<RuleFilterDimension, string[]>>;

/** Parse `dimension=value[,value]` specs (e.g. from repeated `--rule-filter` flags); repeats of a dimension merge. */
export function parseRuleFilter(specs: string[]): RuleFilter {
  const filter: RuleFilter = {};
  for (const spec of specs) {
    const eq = spec.indexOf('=');
    const dimension = spec.slice(0, eq) as RuleFilterDimension;
    const values = spec
      .slice(eq + 1)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (eq < 0 || values.length === 0 || !RULE_FILTER_DIMENSIONS.includes(dimension)) {
      throw new Error(`Invalid rule filter "${spec}". Use <${RULE_FILTER_DIMENSIONS.join('|')}>=<value>[,<value>...].`);
    }
    filter[dimension] = [...(filter[dimension] ?? []), ...values];
  }
  return filter;
}

function dimensionValues(rule: Rule, dimension: RuleFilterDimension): string[] {
  switch (dimension) {
    case 'mode':
      return [rule.mode ?? 'expression'];
    case 'severity':
      return ruleSeverities(rule);
    case 'category':
      return [rule.category];
    case 'type':
      return rule.type ? [rule.type] : [];
    case 'id':
      return [rule.id];
  }
}

/**
 * Keep the rules matching every dimension of the filter. A rule with no `type` never matches a `type` filter,
 * and a rule with a verdict map matches a `severity` filter on any severity it can report.
 */
export function filterRules(rules: Rule[], filter?: RuleFilter): Rule[] {
  if (!filter) return rules;
  return rules.filter((rule) =>
    RULE_FILTER_DIMENSIONS.every((dim) => {
      const wanted = filter[dim];
      if (!wanted) return true;
      return dimensionValues(rule, dim).some((value) => wanted.includes(value));
    }),
  );
}
