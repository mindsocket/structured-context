import type { Rule } from '../types';
import type { SemanticJudgeResult, SemanticRuleSpec } from './types';

/** Verdicts for a semantic rule that declares none. */
export const DEFAULT_VERDICTS: Record<string, string> = {
  pass: 'The node meets the rubric.',
  fail: 'The node does not meet the rubric.',
};

/** Build the judge-facing spec for a semantic rule, applying verdict defaults and checking `failOn`. */
export function semanticRuleSpec(rule: Rule): SemanticRuleSpec {
  const verdicts = rule.verdicts ?? DEFAULT_VERDICTS;
  const failOn = rule.failOn ?? (rule.verdicts ? [] : ['fail']);
  if (failOn.length === 0) {
    throw new Error(
      `Semantic rule "${rule.id}" declares verdicts but no failOn; list the verdicts that count as a violation.`,
    );
  }
  const unknown = failOn.filter((v) => !(v in verdicts));
  if (unknown.length > 0) {
    throw new Error(`Semantic rule "${rule.id}" has failOn verdicts not in its verdicts: ${unknown.join(', ')}.`);
  }
  if (failOn.length >= Object.keys(verdicts).length) {
    throw new Error(`Semantic rule "${rule.id}" has no passing verdict: every verdict is in failOn.`);
  }
  return {
    id: rule.id,
    description: rule.description,
    rubric: rule.rubric,
    category: rule.category,
    verdicts,
    failOn,
  };
}

/** Whether a judge result is an error rather than a verdict. */
export function isJudgeError(result: SemanticJudgeResult): result is { error: string } {
  return 'error' in result;
}
