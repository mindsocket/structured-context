import type { Rule, RuleSeverity, SpaceNode } from '../types';
import type { SemanticJudgeProvider } from './types';
import { isJudgeError, resolveSemanticRule } from './verdicts';

export type NodeJudgement = {
  rule: Rule;
  /** True when the verdict fails the rule (it has a severity), or the judge errored. */
  failed: boolean;
  /** Severity of the failing verdict; unset for a judge error, which takes the rule's own severity. */
  severity?: RuleSeverity;
  verdict?: string;
  /** User-facing guidance declared for the failing verdict. */
  guidance?: string;
  evidence?: string;
  /** Set when the judge could not produce a verdict for this rule. */
  error?: string;
};

type JudgeResults = Awaited<ReturnType<SemanticJudgeProvider['evaluate']>>;
type ResolvedRules = ReturnType<typeof resolveAll>;

function resolveAll(rules: Rule[]) {
  return rules.map(resolveSemanticRule);
}

function errorJudgements(rules: Rule[], message: string): NodeJudgement[] {
  return rules.map((rule) => ({
    rule,
    failed: true,
    evidence: `Error during evaluation: ${message}`,
    error: message,
  }));
}

function interpret(rules: Rule[], resolved: ResolvedRules, results: JudgeResults): NodeJudgement[] {
  return rules.map((rule, i) => {
    const result = results[rule.id];
    if (!result || isJudgeError(result)) {
      const message = result ? result.error : 'Judge returned no result for this rule';
      return { rule, failed: true, evidence: `Error during evaluation: ${message}`, error: message };
    }
    const severity = resolved[i]!.severities[result.verdict];
    if (severity === undefined && !(result.verdict in resolved[i]!.spec.verdicts)) {
      const message = `Judge returned unknown verdict "${result.verdict}" (allowed: ${Object.keys(resolved[i]!.spec.verdicts).join(', ')})`;
      return { rule, failed: true, evidence: `Error during evaluation: ${message}`, error: message };
    }
    const failed = severity !== undefined;
    return {
      rule,
      failed,
      severity,
      verdict: result.verdict,
      guidance: failed ? resolved[i]!.guidance[result.verdict] : undefined,
      evidence: result.evidence,
    };
  });
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Judge every given semantic rule on a node in one provider call. */
export async function judgeNode(
  judge: SemanticJudgeProvider,
  node: SpaceNode,
  rules: Rule[],
): Promise<NodeJudgement[]> {
  if (rules.length === 0) return [];
  const resolved = resolveAll(rules);
  let results: JudgeResults;
  try {
    results = await judge.evaluate({ node, rules: resolved.map((r) => r.spec) });
  } catch (err) {
    return errorJudgements(rules, errorMessage(err));
  }
  return interpret(rules, resolved, results);
}

/**
 * Judge several nodes at once. A judge with `evaluateBatch` gets every node in one call and may fold them into
 * fewer requests; any other judge is called once per node. Results align with `items`. A failure marks only the
 * affected node's rules as errors.
 */
export async function judgeNodes(
  judge: SemanticJudgeProvider,
  items: Array<{ node: SpaceNode; rules: Rule[] }>,
): Promise<NodeJudgement[][]> {
  if (!judge.evaluateBatch) {
    const out: NodeJudgement[][] = [];
    for (const item of items) out.push(await judgeNode(judge, item.node, item.rules));
    return out;
  }
  const active = items
    .map((item, index) => ({ ...item, index, resolved: resolveAll(item.rules) }))
    .filter((a) => a.rules.length > 0);
  const out: NodeJudgement[][] = items.map(() => []);
  if (active.length === 0) return out;
  let batch: JudgeResults[];
  try {
    batch = await judge.evaluateBatch(active.map((a) => ({ node: a.node, rules: a.resolved.map((r) => r.spec) })));
  } catch (err) {
    for (const a of active) out[a.index] = errorJudgements(a.rules, errorMessage(err));
    return out;
  }
  active.forEach((a, k) => {
    out[a.index] = interpret(a.rules, a.resolved, batch[k] ?? {});
  });
  return out;
}
