import type { RuleCategory } from '../types';

/** A semantic rule as presented to a judge: the closed verdict set it must choose from. */
export interface SemanticRuleSpec {
  id: string;
  description: string;
  rubric?: string;
  category: RuleCategory | string;
  /** Allowed verdicts, each with a description of when it applies. */
  verdicts: Record<string, string>;
  /** Verdicts that count as a violation (those with a severity; `ignore`d verdicts pass). */
  failOn: string[];
  /** Name of the judge provider the rule asks for, if any. */
  judge?: string;
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

/** One judge provider: a backend type plus how to reach it. */
export interface JudgeProviderDefinition {
  /** `none` is an inert placeholder for templates; judging with it is an error. */
  type?: 'anthropic' | 'openai' | 'jev' | 'fake' | 'none' | string;
  model?: string;
  endpoint?: string;
  /** Prefer `apiKeyEnv`: keys do not belong in config files. */
  apiKey?: string;
  /** Environment variable holding the key. Defaults to the provider type's usual one (e.g. ANTHROPIC_API_KEY). */
  apiKeyEnv?: string;
}

/**
 * Judge configuration from config file or options. Either the flat shorthand (`type`, `model`, ...), which
 * defines one provider named "default", or several named `providers`.
 */
export interface JudgeConfig {
  type?: 'anthropic' | 'openai' | 'jev' | 'fake' | 'none' | string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  endpoint?: string;
  /** Named providers, for rules (or runs) that pick one by name. */
  providers?: Record<string, JudgeProviderDefinition>;
  /** Provider for rules that name none. Needed when several providers are configured. */
  default?: string;
}

/** Record of a completed semantic evaluation. */
export interface SemanticEvaluationRecord {
  file: string;
  ruleId: string;
  verdict: string;
  /** True when the verdict does not fail the rule (it has no severity, or is `ignore`d). */
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
