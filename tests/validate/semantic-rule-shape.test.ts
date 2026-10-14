import { afterAll, describe, expect, it } from 'bun:test';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { createSpaceContext } from '../../src/space-context';
import type { FileValidationResult } from '../../src/types';
import { validateFile, validateSpace } from '../../src/validate';
import { makeTempSpace } from '../helpers/temp-space';

const spaces: ReturnType<typeof makeTempSpace>[] = [];
afterAll(() => {
  for (const s of spaces) s.cleanup();
});

/** A semantic rule on steps with minor/major verdicts mapped to warning/error and one ignored verdict. */
const stepRule = {
  id: 'step-fit',
  type: 'step',
  mode: 'semantic',
  category: 'coherence',
  description: 'Step fits its task',
  verdicts: {
    fits: 'The step fits',
    minor: { description: 'Slightly off', guidance: 'Tighten the wording.' },
    major: { description: 'Unrelated', guidance: 'Move it under a better task.' },
    unsure: 'Cannot tell',
  },
  severity: { minor: 'warning', major: 'error', unsure: 'ignore' },
};

function setup(rules: object[], options?: Parameters<typeof makeTempSpace>[1]) {
  const space = makeTempSpace(rules, options);
  spaces.push(space);
  return {
    space,
    context: () => createSpaceContext('ts', space.config, { configDir: space.dir }),
  };
}

describe('semantic rules: verdict severity, ignore and guidance', () => {
  it('reports each verdict at its mapped severity with its guidance', async () => {
    const { context } = setup([stepRule]);
    const minor = await validateSpace(context(), {
      semantic: true,
      judgeProvider: new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } }),
    });
    expect(minor.ruleViolations).toEqual([
      expect.objectContaining({
        ruleId: 'step-fit',
        severity: 'warning',
        verdict: 'minor',
        guidance: 'Tighten the wording.',
      }),
    ]);

    const major = await validateSpace(context(), {
      semantic: true,
      judgeProvider: new FakeJudgeProvider({ 'step-fit': { verdict: 'major' } }),
    });
    expect(major.ruleViolations[0]).toMatchObject({ severity: 'error', verdict: 'major' });
  });

  it('judges an ignored verdict without reporting it', async () => {
    const { context } = setup([stepRule]);
    const fake = new FakeJudgeProvider({ 'step-fit': { verdict: 'unsure' } });
    const result = await validateSpace(context(), { semantic: true, judgeProvider: fake });
    expect(fake.callHistory).toHaveLength(1);
    expect(result.ruleViolations).toEqual([]);
  });

  it('gates the subtree per verdict: an error-mapped verdict gates, a warning-mapped one does not', async () => {
    const taskRule = { ...stepRule, id: 'task-fit', type: 'task' };
    const { context } = setup([taskRule, { ...stepRule, id: 'step-fit' }]);

    const minor = new FakeJudgeProvider({ 'task-fit': { verdict: 'minor' } });
    const ungated = await validateSpace(context(), { semantic: true, judgeProvider: minor });
    expect(ungated.coverageGates).toEqual([]);
    expect(minor.callHistory.some((c) => c.node.label === 'S.md')).toBe(true);

    const major = new FakeJudgeProvider({ 'task-fit': { verdict: 'major' } });
    const gated = await validateSpace(context(), { semantic: true, judgeProvider: major });
    expect(gated.coverageGates[0]).toMatchObject({ reason: 'rule', ruleId: 'task-fit' });
    expect(major.callHistory.some((c) => c.node.label === 'S.md')).toBe(false);
  });

  it('shows guidance in validate-file output', async () => {
    const { space } = setup([stepRule]);
    const result = (await validateFile(space.file('S.md'), space.config, {
      semantic: true,
      judgeProvider: new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } }),
      configDir: space.dir,
    })) as FileValidationResult;
    expect(result.warnings['rule:step-fit']?.message).toContain('Guidance: Tighten the wording.');
  });

  it('--rule-filter severity matches any severity a verdict map can report', async () => {
    const { context } = setup([stepRule]);
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } });
    await validateSpace(context(), { semantic: true, judgeProvider: judge, ruleFilter: { severity: ['warning'] } });
    expect(judge.callHistory.length).toBeGreaterThan(0);
    const none = new FakeJudgeProvider();
    await validateSpace(context(), { semantic: true, judgeProvider: none, ruleFilter: { severity: ['info'] } });
    expect(none.callHistory).toHaveLength(0);
  });
});

describe('rule `when` precondition', () => {
  const when = "current.status = 'ready'";

  it('skips an expression rule on nodes where `when` is not true', async () => {
    const rule = {
      id: 'needs-owner',
      category: 'validation',
      description: 'owner',
      check: '$exists(current.owner)',
      when,
    };
    const { context } = setup([rule], { frontmatter: { T: 'status: ready', S: 'status: draft' } });
    const result = await validateSpace(context());
    expect(result.ruleViolations.map((v) => v.file).sort()).toEqual(['T.md']);
  });

  it('does not call the judge for nodes where `when` is not true', async () => {
    const rule = { ...stepRule, id: 'task-fit', type: 'task', when };
    const { context } = setup([rule], { frontmatter: { T: 'status: ready' } });
    const judge = new FakeJudgeProvider();
    await validateSpace(context(), { semantic: true, judgeProvider: judge });
    expect(judge.callHistory.map((c) => c.node.label)).toEqual(['T.md']);

    const none = setup([rule]);
    const idle = new FakeJudgeProvider();
    const result = await validateSpace(none.context(), { semantic: true, judgeProvider: idle });
    expect(idle.callHistory).toHaveLength(0);
    expect(result.coverageGates).toEqual([]); // not applicable is not gated
  });
});

describe('judge configuration', () => {
  const judging = { modelProviders: { llm: { type: 'fake' } } as const, judge: { provider: 'llm' } };

  it('fails before any request when the named provider is not configured', async () => {
    const { context } = setup([stepRule], { judging });
    await expect(validateSpace(context(), { judge: 'nope' })).rejects.toThrow(
      'Model provider "nope" is not configured',
    );
  });

  it('fails before any request when no judge is configured', async () => {
    const { context } = setup([stepRule]);
    await expect(validateSpace(context(), { semantic: true })).rejects.toThrow('No judge configured');
  });

  it('needs no judge configuration while semantic evaluation is not requested', async () => {
    const { context } = setup([stepRule]);
    await expect(validateSpace(context(), {})).resolves.toBeDefined();
  });

  it('builds no judge when the rule filter leaves no semantic rule', async () => {
    const { context } = setup([stepRule]);
    await expect(
      validateSpace(context(), { semantic: true, ruleFilter: { mode: ['expression'] } }),
    ).resolves.toBeDefined();
  });

  it('a judge name implies semantic evaluation, and semantic: false still wins', async () => {
    const { context } = setup([stepRule], { judging });
    const on = new FakeJudgeProvider();
    await validateSpace(context(), { judge: 'llm', judgeProvider: on });
    expect(on.callHistory.length).toBeGreaterThan(0);
    const off = new FakeJudgeProvider();
    await validateSpace(context(), { judge: 'llm', semantic: false, judgeProvider: off });
    expect(off.callHistory).toHaveLength(0);
  });
});

describe('rule expression errors', () => {
  const broken = { id: 'broken', category: 'validation', description: 'Broken check', check: '$notAFunction(' };
  const brokenWhen = {
    id: 'bad-when',
    category: 'coherence',
    description: 'Task rule',
    type: 'task',
    when: '1 +',
    check: 'true',
  };

  it('reports a failing check or when as an error violation instead of passing silently', async () => {
    const { context } = setup([broken, brokenWhen]);
    const result = await validateSpace(context(), {});
    const byId = (id: string) => result.ruleViolations.filter((v) => v.ruleId === id);
    expect(byId('broken').length).toBeGreaterThan(0);
    expect(byId('broken')[0]).toMatchObject({ severity: 'error' });
    expect(byId('broken')[0]?.description).toContain('Rule error');
    expect(byId('bad-when')).toEqual([expect.objectContaining({ file: 'T.md', severity: 'error' })]);
  });
});
