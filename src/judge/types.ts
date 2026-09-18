import type { RuleCategory } from '../types';

/** A semantic rule as presented to a judge: the closed verdict set it must choose from. */
export interface SemanticRuleSpec {
  id: string;
  description: string;
  rubric?: string;
  category: RuleCategory | string;
  /** Allowed verdicts, each with a description of when it applies. */
  verdicts: Record<string, string>;
  /** Verdicts that count as a violation. */
  failOn: string[];
}

/** One node and every semantic rule to judge on it. Judges may answer all rules in a single call. */
export interface SemanticJudgeInput {
  node: {
    label: string;
    title: string;
    type: string;
    resolvedType: string;
    schemaData: Record<string, unknown>;
    resolvedParents?: Array<{ title: string; field: string }>;
  };
  rules: SemanticRuleSpec[];
}

/** A judge's answer for one rule: a verdict from the rule's closed set. */
export interface SemanticJudgeVerdict {
  verdict: string;
  /** 0-1, when the judge reports one. */
  confidence?: number;
  /** Probability per verdict, when the judge reports a distribution. */
  probabilities?: Record<string, number>;
  /** Free-text reasoning; decision models may not provide it. */
  evidence?: string;
}

/** A judge's answer for one rule: a verdict, or an error that applies to that rule only. */
export type SemanticJudgeResult = SemanticJudgeVerdict | { error: string };

/** Judge interface. Results are keyed by rule id; a missing key is treated as an error. */
export interface SemanticJudgeProvider {
  readonly name: string;
  evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>>;
}

/** Judge configuration from config file or options. */
export interface JudgeConfig {
  provider?: 'anthropic' | 'openai' | 'jev' | 'fake' | string;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  autoRun?: boolean;
}

/** Record of a completed semantic evaluation. */
export interface SemanticEvaluationRecord {
  file: string;
  ruleId: string;
  verdict: string;
  /** True when the verdict is not one of the rule's `failOn` verdicts. */
  pass: boolean;
  confidence?: number;
  evidence?: string;
}

/** Record of a rule gated/suppressed due to upstream failure. */
export interface GatedRuleRecord {
  file: string;
  ruleId: string;
  reason: string;
}
