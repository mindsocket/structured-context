import { RESERVED_VERDICTS } from '../src/schema/metadata-contract';
import type { Judgement } from './judge';
import type { Eval } from './load';

/** How well a provider's verdicts on one rule match the labels, over every run. README.md explains each score. */
export interface RuleScore {
  ruleId: string;
  cases: number;
  runs: number;
  agreement: number;
  stable: number;
  expectedProbability?: number;
  reserved: number;
  errors: number;
  /** Cases where some run disagreed with the label, with the verdict (or error) each run gave. */
  misses: Array<{ nodeId: string; expected: string[]; got: string[]; evidence?: string }>;
  /** The agreeing cases with the lowest mean p(expected): the ones nearest to a miss. */
  closest: Array<{ nodeId: string; probability: number }>;
}

const CLOSEST = 3;
const reserved: readonly string[] = RESERVED_VERDICTS;

const describe = (result: Judgement['result'] | undefined) =>
  !result ? 'not judged' : 'error' in result ? `error: ${result.error}` : result.verdict;

/** Score each labelled rule over the runs of one eval with one provider. */
export function scoreEval(evaluation: Pick<Eval, 'expected'>, runs: Judgement[][]): RuleScore[] {
  return Object.entries(evaluation.expected).map(([ruleId, labels]) => {
    const perRun = runs.map((run) => new Map(run.filter((j) => j.ruleId === ruleId).map((j) => [j.nodeId, j.result])));
    let agreeing = 0;
    let stable = 0;
    let errors = 0;
    let reservedCount = 0;
    const probabilities: number[] = [];
    const misses: RuleScore['misses'] = [];
    const agreed: RuleScore['closest'] = [];
    for (const [nodeId, expected] of Object.entries(labels)) {
      const results = perRun.map((run) => run.get(nodeId));
      const verdicts = results.map((r) => (r && !('error' in r) ? r.verdict : undefined));
      agreeing += verdicts.filter((v) => v !== undefined && expected.includes(v)).length;
      reservedCount += verdicts.filter((v) => v !== undefined && reserved.includes(v)).length;
      if (verdicts.includes(undefined)) errors++;
      else if (new Set(verdicts).size === 1) stable++;
      const caseProbabilities = results.flatMap((r) =>
        r && !('error' in r) && r.probabilities
          ? [expected.reduce((sum, v) => sum + (r.probabilities?.[v] ?? 0), 0)]
          : [],
      );
      probabilities.push(...caseProbabilities);
      if (verdicts.some((v) => v === undefined || !expected.includes(v))) {
        const miss = results.find((r) => !r || 'error' in r || !expected.includes(r.verdict));
        misses.push({
          nodeId,
          expected,
          got: results.map(describe),
          ...(miss && !('error' in miss) && miss.evidence !== undefined && { evidence: miss.evidence }),
        });
      } else if (caseProbabilities.length > 0) {
        agreed.push({ nodeId, probability: mean(caseProbabilities) });
      }
    }
    const cases = Object.keys(labels).length;
    return {
      ruleId,
      cases,
      runs: runs.length,
      agreement: cases && runs.length ? agreeing / (cases * runs.length) : 0,
      stable: cases ? stable / cases : 0,
      ...(probabilities.length > 0 && { expectedProbability: mean(probabilities) }),
      reserved: reservedCount,
      errors,
      misses,
      closest: agreed.sort((a, b) => a.probability - b.probability).slice(0, CLOSEST),
    };
  });
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
