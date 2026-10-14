import type { Rule, RuleCategory, RuleSeverity } from '../types';

/** Default severity for each rule category. A rule's own `severity` field overrides this. */
export const DEFAULT_SEVERITY_BY_CATEGORY: Record<RuleCategory, RuleSeverity> = {
  validation: 'error',
  coherence: 'warning',
  workflow: 'warning',
  'best-practice': 'info',
};

const SEVERITY_ORDER: RuleSeverity[] = ['error', 'warning', 'info'];

/** Every severity this rule can report. A verdict map lists several; `ignore` entries report nothing. */
export function ruleSeverities(rule: Rule): RuleSeverity[] {
  if (rule.severity === undefined) return [DEFAULT_SEVERITY_BY_CATEGORY[rule.category]];
  if (typeof rule.severity === 'string') return [rule.severity];
  const mapped = new Set(Object.values(rule.severity).filter((s): s is RuleSeverity => s !== 'ignore'));
  return SEVERITY_ORDER.filter((s) => mapped.has(s));
}

/** Effective severity of a rule: its explicit `severity`, else its category default. With a verdict map, the most severe verdict. */
export function ruleSeverity(rule: Rule): RuleSeverity {
  return ruleSeverities(rule)[0] ?? 'info';
}
