import type { SemanticJudgeInput, SemanticJudgeProvider, SemanticJudgeResult } from '../types';

export interface JevJudgeProviderOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13';
export const DEFAULT_JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

type JevChoiceAnswer = {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

/**
 * Judge provider for TypeSafe's Jev decision model via OpenRouter's Decisions API.
 *
 * Each node is sent once as `state`, with one `choice` question per semantic rule whose criteria are
 * the rule's closed verdict set. Jev returns the chosen verdict with confidence and probabilities,
 * but no prose, so `evidence` is a summary of the distribution.
 */
export class JevJudgeProvider implements SemanticJudgeProvider {
  readonly name = 'jev';
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(options: JevJudgeProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model || DEFAULT_JEV_MODEL;
    this.endpoint = options.endpoint || DEFAULT_JEV_ENDPOINT;
  }

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    const { node, rules } = input;
    const questions: Record<string, unknown> = {};
    for (const rule of rules) {
      questions[rule.id] = {
        type: 'choice',
        instructions: rule.rubric || rule.description,
        criteria: rule.verdicts,
      };
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        state: {
          title: node.title,
          type: node.resolvedType,
          parents: node.resolvedParents?.map((p) => p.title) ?? [],
          ...node.schemaData,
        },
        questions,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Jev API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as { answers?: Record<string, JevChoiceAnswer> };
    const results: Record<string, SemanticJudgeResult> = {};
    for (const rule of rules) {
      const answer = data.answers?.[rule.id];
      if (!answer?.choice || !(answer.choice in rule.verdicts)) {
        results[rule.id] = { error: `Jev returned no valid verdict for rule "${rule.id}" (choice: ${answer?.choice})` };
        continue;
      }
      results[rule.id] = {
        verdict: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        evidence: describeDistribution(answer),
      };
    }
    return results;
  }
}

function describeDistribution(answer: JevChoiceAnswer): string {
  const parts = Object.entries(answer.probabilities ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([verdict, p]) => `${verdict} ${p.toFixed(2)}`);
  const confidence = answer.confidence !== undefined ? `confidence ${answer.confidence.toFixed(2)}` : undefined;
  return `Jev chose "${answer.choice}"${[confidence, ...parts].filter(Boolean).length ? ` (${[confidence, ...parts].filter(Boolean).join('; ')})` : ''}`;
}
