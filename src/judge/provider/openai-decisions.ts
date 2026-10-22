import type { HydratedProvider, SemanticJudgeInput, SemanticJudgeProvider, SemanticJudgeResult } from '../types';

export interface OpenAIDecisionsJudgeProviderOptions extends HydratedProvider {
  apiKey?: string;
}

export const RECOMMENDED_OPENAI_DECISIONS_MODEL = 'gpt-6-luna';
export const OPENAI_DECISIONS_ENDPOINT = 'https://api.openai.com/v1/decisions';

type OpenAIDecisionAnswer = {
  type?: string;
  name?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Array<{ value: string; probability: number }>;
};

/**
 * Judge provider for OpenAI's Decisions API (https://developers.openai.com/api/docs/guides/decisions).
 *
 * Each node is sent once as the `input` text, with one `choice` question per semantic rule whose
 * choices are the rule's closed verdict set. The API returns the chosen value with per-choice
 * probabilities and a confidence, but no prose, so `evidence` is a summary of the distribution.
 */
export class OpenAIDecisionsJudgeProvider implements SemanticJudgeProvider {
  readonly name = 'openai-decisions';
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(options: OpenAIDecisionsJudgeProviderOptions) {
    this.apiKey = options.apiKey ?? '';
    this.model = options.model || RECOMMENDED_OPENAI_DECISIONS_MODEL;
    this.endpoint = options.endpoint || OPENAI_DECISIONS_ENDPOINT;
  }

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    const { node, rules } = input;

    const stateLines = [
      `Title: ${node.title}`,
      `Type: ${node.resolvedType}`,
      ...(node.parentTitles.length ? [`Parents: ${node.parentTitles.join(', ')}`] : []),
      ...fieldLines(node.schemaData ?? {}),
      ...(input.related ?? []).flatMap((r) => [
        '',
        `Related node (${r.relations.join(', ')}): ${r.title}`,
        `Type: ${r.type}`,
        ...fieldLines(r.data),
      ]),
    ];

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: stateLines.join('\n'),
        questions: rules.map((rule) => ({
          type: 'choice',
          name: rule.id,
          instructions: rule.rubric || rule.description,
          choices: Object.entries(rule.verdicts).map(([value, description]) => ({ value, description })),
        })),
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`OpenAI Decisions API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as { answers?: OpenAIDecisionAnswer[] };
    const answers = new Map((data.answers ?? []).filter((a) => a.name).map((a) => [a.name as string, a]));
    const results: Record<string, SemanticJudgeResult> = {};
    for (const rule of rules) {
      const answer = answers.get(rule.id);
      if (!answer || answer.type === 'refusal' || !answer.choice || !(answer.choice in rule.verdicts)) {
        results[rule.id] = { error: `OpenAI Decisions returned no valid verdict for rule "${rule.id}"` };
        continue;
      }
      const probabilities = Object.fromEntries((answer.probabilities ?? []).map((p) => [p.value, p.probability]));
      results[rule.id] = {
        verdict: answer.choice,
        confidence: answer.confidence,
        probabilities,
        evidence: describeDistribution(answer.choice, answer.confidence, probabilities),
      };
    }
    return results;
  }
}

function fieldLines(data: Record<string, unknown>): string[] {
  return Object.entries(data)
    .filter(([field]) => field !== 'title' && field !== 'type')
    .map(([field, value]) => `${field}: ${JSON.stringify(value) ?? String(value)}`);
}

function describeDistribution(
  choice: string,
  confidence: number | undefined,
  probabilities: Record<string, number>,
): string {
  const parts = Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .map(([verdict, p]) => `${verdict} ${p.toFixed(2)}`);
  const conf = confidence !== undefined ? `confidence ${confidence.toFixed(2)}` : undefined;
  const detail = [conf, ...parts].filter(Boolean).join('; ');
  return `OpenAI Decisions chose "${choice}"${detail ? ` (${detail})` : ''}`;
}
