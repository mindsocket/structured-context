import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { checkEval, type Judgement, judgeEval } from '../../evals/judge';
import { loadEvals, resolveSuite } from '../../evals/load';
import { scoreEval } from '../../evals/score';
import type { Config } from '../../src/config';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import type { SemanticJudgeInput } from '../../src/judge/types';

const coreEvals = loadEvals([resolveSuite('core', [])], { spaces: [] });

describe.each(coreEvals.map((e) => [e.name, e] as const))('eval %s', (_name, evaluation) => {
  test('passes its checks', async () => {
    expect(await checkEval(evaluation)).toEqual([]);
  });
});

describe('a suite directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sctx-evals-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (path: string, value: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(value));
  };
  const opportunity = (title: string) => ({
    title,
    type: 'opportunity',
    status: 'identified',
    parent: '[[Grow usage]]',
    source: 'Interviews',
  });
  write('fixtures/tree.json5', {
    schema: 'strict_ost.json',
    nodes: [
      { title: 'Grow usage', type: 'outcome', status: 'identified', metric: 'Weekly active teams' },
      opportunity('Onboarding'),
      opportunity('Build a Slack integration'),
    ],
  });
  write('a.json5', { fixture: 'tree', expected: { 'opportunity-customer-voice': { Onboarding: 'fail' } } });
  write('b.json5', {
    fixture: 'tree',
    expected: { 'opportunity-customer-voice': { 'Grow usage': 'fail', 'Build a Slack integration': ['pass', 'fail'] } },
  });
  for (const title of ['Grow usage', 'Onboarding']) {
    const type =
      title === 'Grow usage' ? 'outcome\nmetric: Weekly active teams' : 'opportunity\nparent: "[[Grow usage]]"';
    mkdirSync(join(dir, 'space'), { recursive: true });
    writeFileSync(
      join(dir, 'space', `${title}.md`),
      `---\nstatus: identified\nsource: Interviews\ntype: ${type}\n---\n`,
    );
  }
  write('mine.json5', { space: 'work', expected: { 'opportunity-customer-voice': { 'Onboarding.md': 'fail' } } });
  const config: Config = {
    spaces: [{ name: 'work', path: join(dir, 'space'), schema: 'strict_ost.json', sourceDir: dir }],
  };
  const [a, b, mine] = loadEvals([resolveSuite(dir, [])], config);

  test('loads each eval file, sharing a fixture between evals', () => {
    expect([a, b, mine].map((e) => e!.name)).toEqual(['a', 'b', 'mine'].map((n) => `${basename(dir)}/${n}`));
    expect(a!.context).toBe(b!.context);
    expect(mine!.context.space.name).toBe('work');
  });

  test('passes an eval that labels only some judged nodes', async () => {
    expect(await checkEval(a!)).toEqual([]);
    expect(await checkEval(mine!)).toEqual([]);
  });

  test('reports labels the rule never judges, and labels that accept every verdict', async () => {
    expect(await checkEval(b!)).toEqual([
      `${b!.name}: rule "opportunity-customer-voice", node "Grow usage": not judged (unknown node, or the rule skips it)`,
      `${b!.name}: rule "opportunity-customer-voice", node "Build a Slack integration": accepts every verdict`,
    ]);
  });

  test('sends only labelled nodes to the provider', async () => {
    const judge = new FakeJudgeProvider({ verdict: 'fail' });
    const judged = await judgeEval(a!, judge);
    expect(judged.map((j) => j.nodeId)).toEqual(['Onboarding']);
    expect(judge.callHistory.map((input) => input.node.id as string)).toEqual(['Onboarding']);
  });
});

describe('judgeEval', () => {
  const [evaluation] = coreEvals;
  /** A judge that packs nodes, counting its calls of each kind. */
  class PackingJudge extends FakeJudgeProvider {
    calls = { evaluate: 0, evaluateNodes: 0 };
    override evaluate(input: SemanticJudgeInput) {
      this.calls.evaluate++;
      return super.evaluate(input);
    }
    async evaluateNodes(inputs: SemanticJudgeInput[]) {
      this.calls.evaluateNodes++;
      return Promise.all(inputs.map((input) => super.evaluate(input)));
    }
  }

  test('passes packed inputs through, or one input per call with perNode', async () => {
    const packed = new PackingJudge();
    const perNode = new PackingJudge();
    const a = await judgeEval(evaluation!, packed);
    const b = await judgeEval(evaluation!, perNode, { perNode: true });
    expect(packed.calls).toEqual({ evaluate: 0, evaluateNodes: expect.any(Number) });
    expect(perNode.calls).toEqual({ evaluate: b.length, evaluateNodes: 0 });
    expect(a.length).toBe(b.length);
  });
});

describe('scoreEval', () => {
  const evaluation = { expected: { r: { a: ['pass'], b: ['fail'], c: ['pass', 'fail'] } } };
  const j = (nodeId: string, verdict: string, probabilities?: Record<string, number>): Judgement => ({
    nodeId,
    ruleId: 'r',
    result: { verdict, ...(probabilities && { probabilities }) },
  });

  test('scores agreement, stability, probability and errors over runs', () => {
    const runs = [
      [j('a', 'pass', { pass: 0.9, fail: 0.1 }), j('b', 'pass', { pass: 0.6, fail: 0.4 }), j('c', 'fail')],
      [j('a', 'pass', { pass: 0.7, fail: 0.3 }), j('b', 'fail', { pass: 0.2, fail: 0.8 })],
    ];
    const [score] = scoreEval(evaluation, runs);
    expect(score).toMatchObject({ cases: 3, runs: 2, stable: 1 / 3, errors: 1, reserved: 0 });
    expect(score!.agreement).toBeCloseTo(4 / 6);
    expect(score!.expectedProbability).toBeCloseTo((0.9 + 0.4 + 0.7 + 0.8) / 4);
    expect(score!.misses).toEqual([
      { nodeId: 'b', expected: ['fail'], got: ['pass', 'fail'] },
      { nodeId: 'c', expected: ['pass', 'fail'], got: ['fail', 'not judged'] },
    ]);
    expect(score!.closest).toEqual([{ nodeId: 'a', probability: expect.closeTo(0.8) }]);
  });

  test('counts reserved verdicts and errors', () => {
    const runs = [[j('a', 'missing-context'), { nodeId: 'b', ruleId: 'r', result: { error: 'boom' } }, j('c', 'pass')]];
    const [score] = scoreEval(evaluation, runs);
    expect(score).toMatchObject({ reserved: 1, errors: 1, agreement: 1 / 3 });
  });
});
