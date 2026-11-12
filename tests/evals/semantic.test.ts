import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  CORE_EVALS_DIR,
  checkEvalSpace,
  type EvalSpace,
  type Judgement,
  judgeEvalSpace,
  loadEvalSpaces,
  resolveEvalSources,
  scoreEvalSpace,
} from '../../evals/semantic/harness';
import type { Config } from '../../src/config';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';

const spaces = loadEvalSpaces(resolveEvalSources('core', []), { spaces: [] });

describe.each(spaces.map((s) => [s.name, s] as const))('eval space %s', (_name, space) => {
  test('passes its checks: labels name real nodes, semantic rules and verdicts, and cover every judged node', async () => {
    expect(await checkEvalSpace(space)).toEqual([]);
  });
});

describe('eval spaces on a configured space', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sctx-evals-'));
  const fixture = join(CORE_EVALS_DIR, 'strict-ost', 'space');
  mkdirSync(join(dir, 'mine'));
  writeFileSync(
    join(dir, 'mine', 'eval.json5'),
    JSON.stringify({
      space: 'work',
      expected: { 'opportunity-customer-voice': { 'Onboarding.md': 'fail', 'Build a Slack integration.md': 'fail' } },
    }),
  );
  const config: Config = { spaces: [{ name: 'work', path: fixture, schema: 'strict_ost.json', sourceDir: dir }] };
  const [space] = loadEvalSpaces(resolveEvalSources(dir, []), config);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('loads the configured space, named by its source directory', () => {
    expect(space).toMatchObject({ name: `${basename(dir)}/mine`, fixture: false });
    expect(space!.context.space.name).toBe('work');
  });

  test('passes its checks without labelling every node', async () => {
    expect(await checkEvalSpace(space!)).toEqual([]);
  });

  test('sends only labelled nodes to the provider', async () => {
    const judge = new FakeJudgeProvider({ verdict: 'fail' });
    const judged = await judgeEvalSpace(space!, judge);
    expect(judged.map((j) => j.nodeId).sort()).toEqual(['Build a Slack integration.md', 'Onboarding.md']);
    expect(judge.callHistory.map((input) => input.node.id as string).sort()).toEqual(
      judged.map((j) => j.nodeId).sort(),
    );
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
