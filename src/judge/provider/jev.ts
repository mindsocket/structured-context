import { estimateTokens } from '../trim';
import type {
  HydratedProvider,
  RelatedNode,
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
 * Request packing limit: the estimated input tokens (characters / 4) packed into one DecisionRequest's `state`
 * plus `questions`. A conservative cost and latency guard. Not the per-node input cap, which bounds one node's input.
 */
export const JEV_REQUEST_PACKING_LIMIT_TOKENS = 32_000;

/** Request packing limit on the number of DecisionQuestions in one DecisionRequest. */
export const JEV_REQUEST_PACKING_LIMIT_QUESTIONS = 40;

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
 * the rule's closed verdict set. `evaluateNodes` shares one DecisionRequest between nodes with the same rule set. Jev returns the chosen verdict with confidence and probabilities,
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
    const results: Record<string, SemanticJudgeResult> = {};
    // A node with more rules than one DecisionRequest allows is split by rule; the state is sent whole each time.
    for (let start = 0; start < rules.length; start += JEV_REQUEST_PACKING_LIMIT_QUESTIONS) {
      const part = rules.slice(start, start + JEV_REQUEST_PACKING_LIMIT_QUESTIONS);
      const questions: Record<string, unknown> = {};
      for (const rule of part) questions[rule.id] = decisionQuestion(rule, rule.rubric || rule.description);
      const data = await this.post(nodeState(node, input.related), questions);
      for (const rule of part) results[rule.id] = toResult(rule, data.answers?.[rule.id]);
    }
    return results;
  }

  /**
   * Judge many nodes with fewer DecisionRequests. Nodes that share the same semantic rule set form a
   * NodeRulesetGroup, sent as one DecisionRequest,
   * with every node under `state.nodes` and one DecisionQuestion per node and rule. A NodeRulesetGroup is split into DecisionRequests by
   * `JEV_REQUEST_PACKING_LIMIT_TOKENS` and `JEV_REQUEST_PACKING_LIMIT_QUESTIONS`, never within a node. A node alone in its DecisionRequest, even
   * one over the token limit, is sent whole as a plain single-node DecisionRequest; one with more rules than the question limit has its rules split
   * across DecisionRequests. A failed DecisionRequest marks only its own nodes' rules
   * as errors.
   */
  async evaluateNodes(inputs: SemanticJudgeInput[]): Promise<Array<Record<string, SemanticJudgeResult>>> {
    const results: Array<Record<string, SemanticJudgeResult>> = inputs.map(() => ({}));
    const nodeRulesetGroups = new Map<string, number[]>();
    inputs.forEach((input, i) => {
      if (input.rules.length === 0) return;
      const key = JSON.stringify(input.rules);
      nodeRulesetGroups.set(key, [...(nodeRulesetGroups.get(key) ?? []), i]);
    });

    for (const indices of nodeRulesetGroups.values()) {
      for (const requestInputs of planDecisionRequests(indices, inputs)) {
        try {
          if (requestInputs.length === 1) {
            results[requestInputs[0]!] = await this.evaluate(inputs[requestInputs[0]!]!);
          } else {
            await this.evaluateDecisionRequest(requestInputs, inputs, results);
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          for (const i of requestInputs) {
            results[i] = Object.fromEntries(inputs[i]!.rules.map((r) => [r.id, { error }]));
          }
        }
      }
    }
    return results;
  }

  private async evaluateDecisionRequest(
    requestInputs: number[],
    inputs: SemanticJudgeInput[],
    results: Array<Record<string, SemanticJudgeResult>>,
  ): Promise<void> {
    const nodes: Record<string, unknown> = {};
    const questions: Record<string, unknown> = {};
    requestInputs.forEach((inputIndex, k) => {
      const input = inputs[inputIndex]!;
      nodes[`n${k}`] = nodeState(input.node, input.related);
      for (const rule of input.rules) {
        questions[`${rule.id}__n${k}`] = decisionQuestion(
          rule,
          `For node \`nodes.n${k}\`: ${rule.rubric || rule.description}`,
        );
      }
    });
    const data = await this.post({ nodes }, questions);
    requestInputs.forEach((inputIndex, k) => {
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

function nodeState(node: SemanticJudgeInput['node'], related: RelatedNode[] = []) {
  return {
    title: node.title,
    type: node.resolvedType,
    parents: node.resolvedParents?.map((p) => p.title) ?? [],
    ...node.schemaData,
    ...(related.length > 0 && {
      relatedNodes: related.map((r) => ({
        relation: r.relations.join(', '),
        title: r.title,
        type: r.type,
        ...r.data,
      })),
    }),
  };
}

function decisionQuestion(rule: SemanticRuleSpec, instructions: string) {
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

/** Plan the DecisionRequests for one NodeRulesetGroup (inputs sharing a rule set): runs of nodes, in order, never splitting a node. */
function planDecisionRequests(indices: number[], inputs: SemanticJudgeInput[]): number[][] {
  const requests: number[][] = [];
  let current: number[] = [];
  let tokens = 0;
  let questions = 0;
  for (const i of indices) {
    const input = inputs[i]!;
    const cost = estimateTokens(nodeState(input.node, input.related)) + estimateTokens(input.rules);
    const count = input.rules.length;
    if (
      current.length > 0 &&
      (tokens + cost > JEV_REQUEST_PACKING_LIMIT_TOKENS || questions + count > JEV_REQUEST_PACKING_LIMIT_QUESTIONS)
    ) {
      requests.push(current);
      current = [];
      tokens = 0;
      questions = 0;
    }
    current.push(i);
    tokens += cost;
    questions += count;
  }
  if (current.length > 0) requests.push(current);
  return requests;
}

function describeDistribution(answer: JevChoiceAnswer): string {
  const parts = Object.entries(answer.probabilities ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([verdict, p]) => `${verdict} ${p.toFixed(2)}`);
  const confidence = answer.confidence !== undefined ? `confidence ${answer.confidence.toFixed(2)}` : undefined;
  return `Jev chose "${answer.choice}"${[confidence, ...parts].filter(Boolean).length ? ` (${[confidence, ...parts].filter(Boolean).join('; ')})` : ''}`;
}
