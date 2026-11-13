import { FakeJudgeProvider } from '../src/judge/provider/fake';
import type { SemanticJudgeInput, SemanticJudgeProvider, SemanticJudgeResult } from '../src/judge/types';
import { resolveSemanticRule } from '../src/judge/verdicts';
import { validateNodes } from '../src/validate';
import type { Eval } from './load';

/** One verdict (or error) the judge gave for a node and rule. */
export interface Judgement {
  nodeId: string;
  ruleId: string;
  result: SemanticJudgeResult;
}

/** Validate with only the eval's labelled rules, judging gated nodes too, as `sctx validate --semantic` would. */
const validate = async (evaluation: Eval, provider: SemanticJudgeProvider) => {
  const read = await evaluation.read();
  return validateNodes(evaluation.context, read.nodes, read, {
    includeGated: true,
    ruleFilter: { id: Object.keys(evaluation.expected) },
    judge: { provider },
  });
};

/**
 * Problems that would make an eval's scores meaningless, found before any paid call. A labelled node's
 * validation errors count, because its rule input would not match a real space.
 */
export async function checkEval(evaluation: Eval): Promise<string[]> {
  const problems: string[] = [];
  const judge = new FakeJudgeProvider();
  const result = await validate(evaluation, judge);
  const judged = new Set(judge.callHistory.flatMap((input) => input.rules.map((r) => `${r.id}\0${input.node.id}`)));
  const labelled = new Set(Object.values(evaluation.expected).flatMap(Object.keys));
  for (const issue of result.issues) {
    if (issue.severity === 'error' && issue.nodeId && labelled.has(issue.nodeId)) {
      problems.push(`${issue.nodeId}: ${issue.message}`);
    }
  }
  const rules = evaluation.context.schema.metadata.rules ?? [];
  for (const [ruleId, labels] of Object.entries(evaluation.expected)) {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule?.semantic) {
      problems.push(`rule "${ruleId}": not a semantic rule of the schema`);
      continue;
    }
    const verdicts = Object.keys(resolveSemanticRule(rule).spec.verdicts);
    for (const [nodeId, expected] of Object.entries(labels)) {
      const at = `rule "${ruleId}", node "${nodeId}"`;
      if (!judged.has(`${ruleId}\0${nodeId}`)) problems.push(`${at}: not judged (unknown node, or the rule skips it)`);
      const unknown = expected.filter((v) => !verdicts.includes(v));
      if (unknown.length > 0) problems.push(`${at}: ${unknown.join(', ')} not a verdict (${verdicts.join(', ')})`);
      else if (verdicts.every((v) => expected.includes(v))) problems.push(`${at}: accepts every verdict`);
    }
  }
  return problems.map((p) => `${evaluation.name}: ${p}`);
}

/**
 * Judge the eval's labelled cases, recording every result the provider returns. Unlabelled nodes still reach
 * the input as related nodes but are not judged themselves. `perNode` hides `evaluateNodes`, so a provider that
 * packs nodes into one request gets one request per node instead.
 */
export async function judgeEval(
  evaluation: Eval,
  provider: SemanticJudgeProvider,
  options: { perNode?: boolean } = {},
): Promise<Judgement[]> {
  const judgements: Judgement[] = [];
  const labelledOnly = (input: SemanticJudgeInput): SemanticJudgeInput | undefined => {
    const rules = input.rules.filter((rule) => evaluation.expected[rule.id]?.[input.node.id] !== undefined);
    return rules.length > 0 ? { ...input, rules } : undefined;
  };
  const record = (input: SemanticJudgeInput, results: Record<string, SemanticJudgeResult>) => {
    for (const rule of input.rules) {
      judgements.push({ nodeId: input.node.id, ruleId: rule.id, result: results[rule.id] ?? { error: 'no result' } });
    }
    return results;
  };
  const recording: SemanticJudgeProvider = {
    name: provider.name,
    async evaluate(input) {
      const sent = labelledOnly(input);
      return sent ? record(sent, await provider.evaluate(sent)) : {};
    },
  };
  const { evaluateNodes } = provider;
  if (evaluateNodes && !options.perNode) {
    recording.evaluateNodes = async (inputs) => {
      const sent = inputs.map(labelledOnly);
      const kept = sent.filter((input) => input !== undefined);
      const results = kept.length > 0 ? await evaluateNodes.call(provider, kept) : [];
      let k = 0;
      return sent.map((input) => (input ? record(input, results[k++] ?? {}) : {}));
    };
  }
  await validate(evaluation, recording);
  return judgements;
}
