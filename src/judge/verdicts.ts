import { RESERVED_VERDICTS } from '../schema/metadata-contract';
import { ruleSemantic, ruleSeverity } from '../schema/rule-severity';
import type { Rule, RuleSeverity } from '../types';
import { ruleContext } from './context';
import type { SemanticJudgeResult, SemanticRuleSpec } from './types';

/** Verdicts for a semantic rule that declares none. */
export const DEFAULT_VERDICTS: Record<string, string> = {
  pass: 'The node meets the rubric.',
  fail: 'The node does not meet the rubric.',
};

/** The reserved verdict a rule with related nodes or bodies offers, for input a trim marker shows was cut. */
const MISSING_CONTEXT_VERDICT = 'missing-context';

const MISSING_CONTEXT_DESCRIPTION =
  'Content needed to judge the rule was cut: a [RULE_EVALUATION_CONTENT_TRIMMED n chars] marker shows where. Choose this only when such a marker is present and the cut content is needed. Never choose it when no marker appears.';

/** A semantic rule resolved for evaluation: what the judge sees, and what each verdict means for the user. */
export interface ResolvedSemanticRule {
  /** What the judge sees: the closed verdict set. */
  spec: SemanticRuleSpec;
  /** Severity of each verdict that fails the rule. A verdict absent here passes (including `ignore`d ones). */
  severities: Record<string, RuleSeverity>;
  /** User-facing guidance for verdicts that declare it. */
  guidance: Record<string, string>;
}

/**
 * Resolve a semantic rule: apply verdict defaults, split each verdict into its judge description and user guidance,
 * and work out which verdicts fail at what severity. Throws on an inconsistent rule.
 */
export function resolveSemanticRule(rule: Rule): ResolvedSemanticRule {
  const semantic = ruleSemantic(rule);
  if (!semantic) throw new Error(`Rule "${rule.id}" has no semantic part.`);
  const declared = semantic.verdicts ?? DEFAULT_VERDICTS;
  const verdicts: Record<string, string> = {};
  const guidance: Record<string, string> = {};
  for (const [name, value] of Object.entries(declared)) {
    if (typeof value === 'string') {
      verdicts[name] = value;
    } else {
      verdicts[name] = value.description;
      if (value.guidance) guidance[name] = value.guidance;
    }
  }

  let mapping: Record<string, RuleSeverity | 'ignore'>;
  if (semantic.verdicts) {
    if (!semantic.severity) {
      throw new Error(
        `Semantic rule "${rule.id}" declares verdicts, so semantic.severity must map the failing verdicts, e.g. { "${Object.keys(verdicts)[0]}": "warning" }.`,
      );
    }
    mapping = semantic.severity;
  } else {
    mapping = { ...semantic.severity, fail: ruleSeverity(rule) };
  }

  const reserved: readonly string[] = RESERVED_VERDICTS;
  const unknown = Object.keys(mapping).filter((v) => !(v in verdicts) && !reserved.includes(v));
  if (unknown.length > 0) {
    throw new Error(
      `Semantic rule "${rule.id}" has semantic.severity for verdicts not in its verdicts: ${unknown.join(', ')}.`,
    );
  }
  const severities: Record<string, RuleSeverity> = {};
  for (const [verdict, severity] of Object.entries(mapping)) {
    if (severity !== 'ignore') severities[verdict] = severity;
  }
  if (Object.keys(severities).filter((v) => v in verdicts).length >= Object.keys(verdicts).length) {
    throw new Error(`Semantic rule "${rule.id}" has no passing verdict: every verdict has a severity.`);
  }

  // A warning by default.
  const context = ruleContext(rule);
  if (context.scope.length > 0 || context.content !== 'none') {
    verdicts[MISSING_CONTEXT_VERDICT] = MISSING_CONTEXT_DESCRIPTION;
    if (!(MISSING_CONTEXT_VERDICT in mapping)) severities[MISSING_CONTEXT_VERDICT] = 'warning';
  }

  return {
    spec: {
      id: rule.id,
      description: rule.description,
      rubric: semantic.rubric,
      category: rule.category,
      verdicts,
    },
    severities,
    guidance,
  };
}

/** The judge-facing spec for a semantic rule. */
export function semanticRuleSpec(rule: Rule): SemanticRuleSpec {
  return resolveSemanticRule(rule).spec;
}

/** Whether a judge result is an error rather than a verdict. */
export function isJudgeError(result: SemanticJudgeResult): result is { error: string } {
  return 'error' in result;
}
