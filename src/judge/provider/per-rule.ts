import type {
  RelatedNode,
  SemanticJudgeInput,
  SemanticJudgeProvider,
  SemanticJudgeResult,
  SemanticRuleSpec,
} from '../types';

/**
 * Base for providers that can only judge one rule per request (chat LLMs). `evaluate` makes one call
 * per rule; a failure on one rule is reported for that rule and does not affect the others.
 */
export abstract class PerRuleJudgeProvider implements SemanticJudgeProvider {
  abstract readonly name: string;

  protected abstract judgeRule(
    node: SemanticJudgeInput['node'],
    rule: SemanticRuleSpec,
    related: RelatedNode[],
  ): Promise<SemanticJudgeResult>;

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    const results: Record<string, SemanticJudgeResult> = {};
    for (const rule of input.rules) {
      try {
        results[rule.id] = await this.judgeRule(input.node, rule, input.related ?? []);
      } catch (err) {
        results[rule.id] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return results;
  }
}
