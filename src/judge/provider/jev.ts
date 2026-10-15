import type {
  HydratedProvider,
  SemanticJudgeInput,
  SemanticJudgeProvider,
  SemanticJudgeResult,
  SemanticRuleSpec,
} from '../types';

export interface JevJudgeProviderOptions extends HydratedProvider {
  apiKey?: string;
}

export const JEV_LATEST = 'jev-latest';

export const OPENROUTER_DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

/**
 * Estimated input-token cap (characters / 4) for one batched request. Conservative: issue #152 cites a
 * "32k token limit for state plus questions" for Jev, which is unverified. measured: a live probe accepted a
 * 250k-token state through OpenRouter with HTTP 200, so the real limit is higher and this cap is a cost and
 * latency guard, not a hard limit.
 */
export const JEV_BATCH_MAX_TOKENS = 32_000;

/** Cap on questions per batched request. Sourced from the jev-rank reference client (20 pairs x 2 = 40 per request). */
export const JEV_BATCH_MAX_QUESTIONS = 40;

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
 * the rule's closed verdict set. `evaluateBatch` shares one request between nodes with the same rule set. Jev returns the chosen verdict with confidence and probabilities,
 * but no prose, so `evidence` is a summary of the distribution.
 */
export class JevJudgeProvider implements SemanticJudgeProvider {
  readonly name = 'jev';
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(options: JevJudgeProviderOptions) {
    this.apiKey = options.apiKey ?? '';
    this.model = options.model || JEV_LATEST;
    this.endpoint = options.endpoint || OPENROUTER_DECISIONS_ENDPOINT;
  }

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    const { node, rules } = input;
    const questions: Record<string, unknown> = {};
    for (const rule of rules) questions[rule.id] = choiceQuestion(rule, rule.rubric || rule.description);
    const data = await this.post(nodeState(node), questions);
    const results: Record<string, SemanticJudgeResult> = {};
    for (const rule of rules) results[rule.id] = toResult(rule, data.answers?.[rule.id]);
    return results;
  }

  /**
   * Judge many nodes with fewer requests. Nodes that share the same semantic rule set go into one request,
   * with every node under `state.nodes` and one question per node and rule. A group is split into chunks by
   * `JEV_BATCH_MAX_TOKENS` and `JEV_BATCH_MAX_QUESTIONS`, never within a node. A node alone in its chunk, even
   * one over the cap, is sent as a plain single-node request. A failed request marks only its own nodes' rules
   * as errors.
   */
  async evaluateBatch(inputs: SemanticJudgeInput[]): Promise<Array<Record<string, SemanticJudgeResult>>> {
    const results: Array<Record<string, SemanticJudgeResult>> = inputs.map(() => ({}));
    const groups = new Map<string, number[]>();
    inputs.forEach((input, i) => {
      if (input.rules.length === 0) return;
      const key = JSON.stringify(input.rules);
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });

    for (const indices of groups.values()) {
      for (const chunk of chunkGroup(indices, inputs)) {
        try {
          if (chunk.length === 1) {
            results[chunk[0]!] = await this.evaluate(inputs[chunk[0]!]!);
          } else {
            await this.evaluateChunk(chunk, inputs, results);
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          for (const i of chunk) {
            results[i] = Object.fromEntries(inputs[i]!.rules.map((r) => [r.id, { error }]));
          }
        }
      }
    }
    return results;
  }

  private async evaluateChunk(
    chunk: number[],
    inputs: SemanticJudgeInput[],
    results: Array<Record<string, SemanticJudgeResult>>,
  ): Promise<void> {
    const nodes: Record<string, unknown> = {};
    const questions: Record<string, unknown> = {};
    chunk.forEach((inputIndex, k) => {
      const input = inputs[inputIndex]!;
      nodes[`n${k}`] = nodeState(input.node);
      for (const rule of input.rules) {
        questions[`${rule.id}__n${k}`] = choiceQuestion(
          rule,
          `For state.nodes.n${k}: ${rule.rubric || rule.description}`,
        );
      }
    });
    const data = await this.post({ nodes }, questions);
    chunk.forEach((inputIndex, k) => {
      for (const rule of inputs[inputIndex]!.rules) {
        results[inputIndex]![rule.id] = toResult(rule, data.answers?.[`${rule.id}__n${k}`]);
      }
    });
  }

  private async post(state: unknown, questions: Record<string, unknown>): Promise<JevResponse> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, state, questions }),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Jev API error (${res.status}): ${errorText}`);
    }
    return (await res.json()) as JevResponse;
  }
}

type JevResponse = { answers?: Record<string, JevChoiceAnswer> };

function nodeState(node: SemanticJudgeInput['node']) {
  return {
    title: node.title,
    type: node.resolvedType,
    parents: node.resolvedParents?.map((p) => p.title) ?? [],
    ...node.schemaData,
  };
}

function choiceQuestion(rule: SemanticRuleSpec, instructions: string) {
  return { type: 'choice', instructions, criteria: rule.verdicts };
}

function toResult(rule: SemanticRuleSpec, answer: JevChoiceAnswer | undefined): SemanticJudgeResult {
  if (!answer?.choice || !(answer.choice in rule.verdicts)) {
    return { error: `Jev returned no valid verdict for rule "${rule.id}" (choice: ${answer?.choice})` };
  }
  return {
    verdict: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    evidence: describeDistribution(answer),
  };
}

const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

/** Split same-rule-set inputs into request-sized chunks, in order, never splitting a node. */
function chunkGroup(indices: number[], inputs: SemanticJudgeInput[]): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let tokens = 0;
  let questions = 0;
  for (const i of indices) {
    const input = inputs[i]!;
    const cost = estimateTokens(nodeState(input.node)) + estimateTokens(input.rules);
    const count = input.rules.length;
    if (current.length > 0 && (tokens + cost > JEV_BATCH_MAX_TOKENS || questions + count > JEV_BATCH_MAX_QUESTIONS)) {
      chunks.push(current);
      current = [];
      tokens = 0;
      questions = 0;
    }
    current.push(i);
    tokens += cost;
    questions += count;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function describeDistribution(answer: JevChoiceAnswer): string {
  const parts = Object.entries(answer.probabilities ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([verdict, p]) => `${verdict} ${p.toFixed(2)}`);
  const confidence = answer.confidence !== undefined ? `confidence ${answer.confidence.toFixed(2)}` : undefined;
  return `Jev chose "${answer.choice}"${[confidence, ...parts].filter(Boolean).length ? ` (${[confidence, ...parts].filter(Boolean).join('; ')})` : ''}`;
}
