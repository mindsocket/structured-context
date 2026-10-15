import type { RuleCategory, SpaceNode } from '../types';

/** A semantic rule as presented to a judge: the closed verdict set it must choose from. */
export interface SemanticRuleSpec {
  id: string;
  description: string;
  rubric?: string;
  category: RuleCategory | string;
  /** Allowed verdicts, each with a description of when it applies. */
  verdicts: Record<string, string>;
}

/** One node and every semantic rule to judge on it. Judges may answer all rules in a single call. */
export interface SemanticJudgeInput {
  node: Pick<SpaceNode, 'label' | 'title' | 'type' | 'resolvedType' | 'schemaData' | 'resolvedParents'>;
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

/** Model provider types. `fake` is for tests. */
export const MODEL_PROVIDER_TYPES = ['anthropic', 'openai', 'jev', 'fake'] as const;
export type ModelProviderType = (typeof MODEL_PROVIDER_TYPES)[number];

/** How to reach a model: config `modelProviders.<name>`. */
export interface ModelProviderConfig {
  type: ModelProviderType;
  model?: string;
  endpoint?: string;
  /** Prefer `apiKeyEnv`: keys do not belong in config files. */
  apiKey?: string;
  /** Environment variable holding the key. Defaults to the provider type's usual one (e.g. ANTHROPIC_API_KEY). */
  apiKeyEnv?: string;
}

/** Which model provider judges semantic rules: config `judge`, at the top level or on a space. */
export interface JudgeConfig {
  /** Name of an entry in `modelProviders`, or a bundled provider ("jev", "anthropic", "openai"). */
  provider?: string;
}
