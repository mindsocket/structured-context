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

/** Wire APIs a provider can speak. Names the request shape, never the vendor or model. */
export const MODEL_PROVIDER_APIS = [
  'openai-completions',
  'anthropic-messages',
  'openrouter-decisions',
  'typesafe-systemone',
  'fake',
] as const;
export type ModelProviderApi = (typeof MODEL_PROVIDER_APIS)[number];

/** How to reach a model: a bundled provider or config `modelProviders.<name>`, before hydration. */
export interface ModelProviderConfig {
  /** The wire API to speak. */
  api: ModelProviderApi;
  /** Fixed model override. Beats `modelEnv` and the bundled default. */
  model?: string;
  /** Environment variable that holds the model override. */
  modelEnv?: string;
  /** Fixed endpoint override. Beats `endpointEnv` and the bundled default. */
  endpoint?: string;
  /** Environment variable that holds the endpoint override. */
  endpointEnv?: string;
  /** Prefer `apiKeyEnv`: keys do not belong in config files. */
  apiKey?: string;
  /** Environment variable holding the key. */
  apiKeyEnv?: string;
}

/** A provider after hydration: every field is a concrete value; the implementation reads no environment. */
export interface HydratedProvider {
  api: ModelProviderApi;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  /** The environment variable the key was read from, when one was named or defaulted. */
  keyEnv?: string;
}

/** Which model provider judges semantic rules: config `judge`, at the top level or on a space. */
export interface JudgeConfig {
  /** Name of an entry in `modelProviders`, or a bundled provider. */
  provider?: string;
}
