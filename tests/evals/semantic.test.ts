import { describe, expect, test } from 'bun:test';
import {
  checkEvalSpace,
  type EvalSpace,
  type Judgement,
  judgeEvalSpace,
  loadEvalSpaces,
  scoreEvalSpace,
} from '../../evals/semantic/harness';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';

const spaces = loadEvalSpaces();

/** A judge that gives every labelled case its first expected verdict. */
const labelJudge = (space: EvalSpace) =>
  new FakeJudgeProvider(({ node, rule }) => ({ verdict: space.expected[rule.id]?.[node.id]?.[0] ?? 'unlabelled' }));

describe.each(spaces.map((s) => [s.name, s] as const))('eval space %s', (_name, space) => {
  test('is valid and its labels name real nodes, semantic rules and verdicts', async () => {
    expect(await checkEvalSpace(space)).toEqual([]);
  });

  test('every judged node is labelled, and every label is judged', async () => {
    const scores = scoreEvalSpace(space, [await judgeEvalSpace(space, labelJudge(space))]);
    for (const score of scores) {
      expect(score.unlabelled).toEqual([]);
      expect(score.misses).toEqual([]);
      expect(score.agreement).toBe(1);
    }
  });
});

describe('judgeEvalSpace', () => {
  const [space] = spaces;
  /** A judge that packs nodes, counting its calls of each kind. */
  class PackingJudge extends FakeJudgeProvider {
    calls = { evaluate: 0, evaluateNodes: 0 };
    override evaluate(input: Parameters<FakeJudgeProvider['evaluate']>[0]) {
      this.calls.evaluate++;
      return super.evaluate(input);
    }
    async evaluateNodes(inputs: Parameters<FakeJudgeProvider['evaluate']>[0][]) {
      this.calls.evaluateNodes++;
      return Promise.all(inputs.map((input) => super.evaluate(input)));
    }
  }

  test('passes packed inputs through, or one input per call with perNode', async () => {
    const packed = new PackingJudge();
    const perNode = new PackingJudge();
    const a = await judgeEvalSpace(space!, packed);
    const b = await judgeEvalSpace(space!, perNode, { perNode: true });
    expect(packed.calls).toEqual({ evaluate: 0, evaluateNodes: expect.any(Number) });
    expect(perNode.calls).toEqual({ evaluate: b.length, evaluateNodes: 0 });
    expect(a.length).toBe(b.length);
  });
});

describe('scoreEvalSpace', () => {
  const space = {
    name: 'x',
    expected: { r: { a: ['pass'], b: ['fail'], c: ['pass', 'fail'] } },
  } as unknown as EvalSpace;
  const j = (nodeId: string, verdict: string, probabilities?: Record<string, number>): Judgement => ({
    nodeId,
    ruleId: 'r',
    result: { verdict, ...(probabilities && { probabilities }) },
  });

  test('scores agreement, stability, probability, errors and unlabelled nodes over runs', () => {
    const runs = [
      [
        j('a', 'pass', { pass: 0.9, fail: 0.1 }),
        j('b', 'pass', { pass: 0.6, fail: 0.4 }),
        j('c', 'fail'),
        j('d', 'pass'),
      ],
      [j('a', 'pass', { pass: 0.7, fail: 0.3 }), j('b', 'fail', { pass: 0.2, fail: 0.8 })],
    ];
    const [score] = scoreEvalSpace(space, runs);
    expect(score).toMatchObject({ cases: 3, runs: 2, stable: 1 / 3, errors: 1, reserved: 0, unlabelled: ['d'] });
    expect(score!.agreement).toBeCloseTo(4 / 6);
    expect(score!.expectedProbability).toBeCloseTo((0.9 + 0.4 + 0.7 + 0.8) / 4);
    expect(score!.misses).toEqual([
      { nodeId: 'b', expected: ['fail'], got: ['pass', 'fail'] },
      { nodeId: 'c', expected: ['pass', 'fail'], got: ['fail', 'not judged'] },
    ]);
  });

  test('counts reserved verdicts and errors', () => {
    const runs = [[j('a', 'missing-context'), { nodeId: 'b', ruleId: 'r', result: { error: 'boom' } }, j('c', 'pass')]];
    const [score] = scoreEvalSpace(space, runs);
    expect(score).toMatchObject({ reserved: 1, errors: 1, agreement: 1 / 3 });
  });
});
