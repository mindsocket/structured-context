import type { Rule, SpaceNode } from '../types';
import type { SemanticEvaluationRecord, SemanticJudgeProvider } from './types';
import { isJudgeError, semanticRuleSpec } from './verdicts';

export type NodeJudgement = {
  rule: Rule;
  /** True when the verdict is one of the rule's `failOn` verdicts, or the judge errored. */
  failed: boolean;
  evidence?: string;
  /** Set when the judge could not produce a verdict for this rule. */
  error?: string;
  /** Present when the judge produced a verdict. */
  record?: SemanticEvaluationRecord;
};

/** Judge every given semantic rule on a node in one provider call. */
export async function judgeNode(
  judge: SemanticJudgeProvider,
  node: SpaceNode,
  rules: Rule[],
): Promise<NodeJudgement[]> {
  if (rules.length === 0) return [];
  const specs = rules.map(semanticRuleSpec);
  let results: Awaited<ReturnType<SemanticJudgeProvider['evaluate']>>;
  try {
    results = await judge.evaluate({
      node: {
        label: node.label,
        title: node.title,
        type: node.type,
        resolvedType: node.resolvedType,
        schemaData: node.schemaData,
        resolvedParents: node.resolvedParents.map((p) => ({ title: p.title, field: p.field })),
      },
      rules: specs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return rules.map((rule) => ({
      rule,
      failed: true,
      evidence: `Error during evaluation: ${message}`,
      error: message,
    }));
  }

  return rules.map((rule, i) => {
    const result = results[rule.id];
    if (!result || isJudgeError(result)) {
      const message = result ? result.error : 'Judge returned no result for this rule';
      return { rule, failed: true, evidence: `Error during evaluation: ${message}`, error: message };
    }
    const failed = specs[i]!.failOn.includes(result.verdict);
    return {
      rule,
      failed,
      evidence: result.evidence,
      record: {
        file: node.label,
        ruleId: rule.id,
        verdict: result.verdict,
        pass: !failed,
        confidence: result.confidence,
        evidence: result.evidence,
      },
    };
  });
}
