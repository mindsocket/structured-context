import type { SemanticJudgeInput, SemanticJudgeProvider, SemanticJudgeResult, SemanticRuleSpec } from './types';

/** A fake answer: a full verdict, or the `{ pass }` shorthand mapped onto the default `pass`/`fail` verdicts. */
export type FakeAnswer = SemanticJudgeResult | { pass: boolean; evidence?: string };

export type FakeJudgeHandler = (call: {
  node: SemanticJudgeInput['node'];
  rule: SemanticRuleSpec;
}) => Promise<FakeAnswer> | FakeAnswer;

type FakeConfig = FakeAnswer | FakeJudgeHandler | Map<string, FakeAnswer> | Record<string, FakeAnswer>;

function isHandler(c: FakeConfig): c is FakeJudgeHandler {
  return typeof c === 'function';
}

function isAnswer(c: FakeConfig): c is FakeAnswer {
  return 'pass' in c || 'verdict' in c || 'error' in c;
}

function normalise(answer: FakeAnswer): SemanticJudgeResult {
  if ('pass' in answer) {
    return { verdict: answer.pass ? 'pass' : 'fail', evidence: answer.evidence };
  }
  return answer;
}

/**
 * In-memory fake judge for offline, deterministic tests. Configure with a single answer, a handler,
 * or answers keyed by `ruleId:title`, `ruleId:label` or `ruleId` (most specific wins). Unmatched calls pass.
 */
export class FakeJudgeProvider implements SemanticJudgeProvider {
  readonly name = 'fake';
  public callHistory: SemanticJudgeInput[] = [];

  constructor(private config?: FakeConfig) {}

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    this.callHistory.push(input);
    const results: Record<string, SemanticJudgeResult> = {};
    for (const rule of input.rules) {
      results[rule.id] = normalise(await this.answer(input.node, rule));
    }
    return results;
  }

  private async answer(node: SemanticJudgeInput['node'], rule: SemanticRuleSpec): Promise<FakeAnswer> {
    const passing = { verdict: Object.keys(rule.verdicts).find((v) => !rule.failOn.includes(v)) ?? 'pass' };
    const fallback = { ...passing, evidence: `Fake passed evaluation for rule "${rule.id}"` };
    const config = this.config;
    if (!config) return fallback;
    if (isHandler(config)) return await config({ node, rule });
    if (config instanceof Map) {
      return (
        config.get(`${rule.id}:${node.title}`) ??
        config.get(`${rule.id}:${node.label}`) ??
        config.get(rule.id) ??
        fallback
      );
    }
    if (isAnswer(config)) return config;
    const rec = config as Record<string, FakeAnswer>;
    return rec[`${rule.id}:${node.title}`] ?? rec[`${rule.id}:${node.label}`] ?? rec[rule.id] ?? fallback;
  }

  clearHistory(): void {
    this.callHistory = [];
  }
}
