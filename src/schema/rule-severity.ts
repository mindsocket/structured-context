import type { Rule, RuleCategory, RuleSeverity } from '../types';
import type { RuleSemantic } from './metadata-contract';

/** Default severity for each rule category. A rule's own `severity` field overrides this. */
export const DEFAULT_SEVERITY_BY_CATEGORY: Record<RuleCategory, RuleSeverity> = {
  validation: 'error',
  coherence: 'warning',
  workflow: 'warning',
  'best-practice': 'info',
};

const SEVERITY_ORDER: RuleSeverity[] = ['error', 'warning', 'info'];

/** The rule's semantic part as an object (`semantic: true` means `{}`), or undefined for a rule without one. */
export function ruleSemantic(rule: Rule): RuleSemantic | undefined {
  if (rule.semantic === undefined) return undefined;
  return rule.semantic === true ? {} : rule.semantic;
}

/** Severity of a failed `expression` and of the default `fail` verdict: the rule's `severity`, else its category default. */
export function ruleSeverity(rule: Rule): RuleSeverity {
  return rule.severity ?? DEFAULT_SEVERITY_BY_CATEGORY[rule.category];
}

/**
 * Every severity this rule can report: that of its failed `expression` (or default `fail` verdict), plus those
 * its semantic verdict map sets. `ignore` entries report nothing. Most severe first.
 */
export function ruleSeverities(rule: Rule): RuleSeverity[] {
  const semantic = ruleSemantic(rule);
  const found = new Set<RuleSeverity>();
  if (rule.expression !== undefined || (semantic && !semantic.verdicts)) found.add(ruleSeverity(rule));
  for (const severity of Object.values(semantic?.severity ?? {})) {
    if (severity !== 'ignore') found.add(severity);
  }
  return SEVERITY_ORDER.filter((s) => found.has(s));
}
