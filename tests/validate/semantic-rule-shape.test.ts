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
      judge: new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } }),
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
      judge: new FakeJudgeProvider({ 'step-fit': { verdict: 'major' } }),
    });
    expect(major.ruleViolations[0]).toMatchObject({ severity: 'error', verdict: 'major' });
  });

  it('judges an ignored verdict without reporting it', async () => {
    const { context } = setup([stepRule]);
    const fake = new FakeJudgeProvider({ 'step-fit': { verdict: 'unsure' } });
    const result = await validateSpace(context(), { judge: fake });
    expect(fake.callHistory).toHaveLength(1);
    expect(result.ruleViolations).toEqual([]);
  });

  it('gates the subtree per verdict: an error-mapped verdict gates, a warning-mapped one does not', async () => {
    const taskRule = { ...stepRule, id: 'task-fit', type: 'task' };
    const { context } = setup([taskRule, { ...stepRule, id: 'step-fit' }]);

    const minor = new FakeJudgeProvider({ 'task-fit': { verdict: 'minor' } });
    const ungated = await validateSpace(context(), { judge: minor });
    expect(ungated.coverageGates).toEqual([]);
    expect(minor.callHistory.some((c) => c.node.label === 'S.md')).toBe(true);

    const major = new FakeJudgeProvider({ 'task-fit': { verdict: 'major' } });
    const gated = await validateSpace(context(), { judge: major });
    expect(gated.coverageGates[0]).toMatchObject({ reason: 'rule', ruleId: 'task-fit' });
    expect(major.callHistory.some((c) => c.node.label === 'S.md')).toBe(false);
  });

  it('shows guidance in validate-file output', async () => {
    const { space } = setup([stepRule]);
    const result = (await validateFile(space.file('S.md'), space.config, {
      judge: new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } }),
      configDir: space.dir,
    })) as FileValidationResult;
    expect(result.warnings['rule:step-fit']?.message).toContain('Guidance: Tighten the wording.');
  });

  it('--rule-filter severity matches any severity a verdict map can report', async () => {
    const { context } = setup([stepRule]);
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } });
    await validateSpace(context(), { judge: judge, ruleFilter: { severity: ['warning'] } });
    expect(judge.callHistory.length).toBeGreaterThan(0);
    const none = new FakeJudgeProvider();
    await validateSpace(context(), { judge: none, ruleFilter: { severity: ['info'] } });
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
    await validateSpace(context(), { judge: judge });
    expect(judge.callHistory.map((c) => c.node.label)).toEqual(['T.md']);

    const none = setup([rule]);
    const idle = new FakeJudgeProvider();
    const result = await validateSpace(none.context(), { judge: idle });
    expect(idle.callHistory).toHaveLength(0);
    expect(result.coverageGates).toEqual([]); // not applicable is not gated
  });
});

describe('judge option', () => {
  it('evaluates no semantic rules without a judge', async () => {
    const { context } = setup([stepRule]);
    const result = await validateSpace(context(), {});
    expect(result.ruleViolations).toEqual([]);
  });

  it('judges with the judge it is given', async () => {
    const { context } = setup([stepRule]);
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } });
    const result = await validateSpace(context(), { judge });
    expect(judge.callHistory.length).toBeGreaterThan(0);
    expect(result.ruleViolations[0]).toMatchObject({ verdict: 'minor' });
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

describe('semantic rule check precondition', () => {
  const gated = {
    id: 'step-fit',
    type: 'step',
    mode: 'semantic',
    category: 'coherence',
    description: 'Step fits its task',
    check: '$exists(current.owner)',
    gatesDescendants: true,
  };
  const judgedLabels = (judge: FakeJudgeProvider) => judge.callHistory.map((c) => c.node.label);

  it('judges when the check passes', async () => {
    const { context } = setup([gated], { frontmatter: { S: 'owner: sam' } });
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'fail' } });
    const result = await validateSpace(context(), { judge });
    expect(judgedLabels(judge)).toEqual(['S.md']);
    expect(result.ruleViolations).toEqual([expect.objectContaining({ ruleId: 'step-fit', verdict: 'fail' })]);
  });

  it('reports a failing check at the rule severity without calling the judge', async () => {
    const { context } = setup([gated]);
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'fail' } });
    const result = await validateSpace(context(), { judge });
    expect(judge.callHistory).toHaveLength(0);
    expect(result.ruleViolations).toEqual([
      {
        file: 'S.md',
        ruleId: 'step-fit',
        category: 'coherence',
        severity: 'warning',
        description: 'Step fits its task',
        evidence: 'expression check failed: $exists(current.owner)',
      },
    ]);
  });

  it('reports a failing check at the most severe mapped severity', async () => {
    const { context } = setup([{ ...stepRule, check: '$exists(current.owner)' }]);
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } });
    const result = await validateSpace(context(), { judge });
    expect(judge.callHistory).toHaveLength(0);
    expect(result.ruleViolations).toEqual([expect.objectContaining({ ruleId: 'step-fit', severity: 'error' })]);
    expect(result.ruleViolations[0]?.verdict).toBeUndefined();
  });

  it('gates descendants of a failing check only with an explicit gatesDescendants: true', async () => {
    const taskRule = { ...gated, id: 'task-fit', type: 'task' };
    const explicit = setup([taskRule, stepRule]);
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } });
    const result = await validateSpace(explicit.context(), { judge });
    expect(judgedLabels(judge)).toEqual([]);
    expect(result.coverageGates[0]).toMatchObject({ reason: 'rule', ruleId: 'task-fit' });
    expect(result.ruleViolations.map((v) => v.ruleId)).toEqual(['task-fit']);

    const implicit = setup([{ ...taskRule, gatesDescendants: undefined, severity: 'error' }, stepRule]);
    const open = new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } });
    const ungated = await validateSpace(implicit.context(), { judge: open });
    expect(judgedLabels(open)).toEqual(['S.md']);
    expect(ungated.coverageGates).toEqual([]);
    expect(ungated.ruleViolations.map((v) => v.ruleId).sort()).toEqual(['step-fit', 'task-fit']);
  });

  it('gates the file when an ancestor check fails (single-file validation)', async () => {
    const { space } = setup([{ ...gated, id: 'task-fit', type: 'task' }, stepRule]);
    const judge = new FakeJudgeProvider({ 'step-fit': { verdict: 'minor' } });
    const result = (await validateFile(space.file('S.md'), space.config, {
      judge,
      configDir: space.dir,
    })) as FileValidationResult;
    // T.md's failing check gates S.md, so S.md is not judged and only reports the gate.
    expect(judgedLabels(judge)).toEqual([]);
    expect(Object.keys(result.warnings)).toEqual(['gated:T.md']);
    expect(result.warnings['gated:T.md']?.message).toContain('task-fit');
  });

  describe('without a judge', () => {
    it('reports a failing check, marked as an expression check failure', async () => {
      const { context } = setup([gated]);
      const result = await validateSpace(context(), {});
      expect(result.ruleViolations).toEqual([
        expect.objectContaining({
          ruleId: 'step-fit',
          file: 'S.md',
          evidence: 'expression check failed: $exists(current.owner)',
        }),
      ]);
    });

    it('reports nothing when the check passes', async () => {
      const { context } = setup([gated], { frontmatter: { S: 'owner: sam' } });
      const result = await validateSpace(context(), {});
      expect(result.ruleViolations).toEqual([]);
    });

    it('still skips a semantic rule that has no check', async () => {
      const { context } = setup([stepRule]);
      expect((await validateSpace(context(), {})).ruleViolations).toEqual([]);
    });

    it('honours --rule-filter mode=semantic', async () => {
      const { context } = setup([gated]);
      const kept = await validateSpace(context(), { ruleFilter: { mode: ['semantic'] } });
      expect(kept.ruleViolations).toHaveLength(1);
      const dropped = await validateSpace(context(), { ruleFilter: { mode: ['expression'] } });
      expect(dropped.ruleViolations).toEqual([]);
    });
  });

  it('reports a failing check with an all-ignore severity map at info', async () => {
    const rule = { ...stepRule, severity: { minor: 'ignore', major: 'ignore' }, check: '$exists(current.owner)' };
    const { context } = setup([rule]);
    const result = await validateSpace(context(), {});
    expect(result.ruleViolations).toEqual([expect.objectContaining({ ruleId: 'step-fit', severity: 'info' })]);
  });

  it('evaluates when before check', async () => {
    const { context } = setup([{ ...gated, when: 'false' }]);
    const judge = new FakeJudgeProvider();
    const result = await validateSpace(context(), { judge });
    expect(judge.callHistory).toHaveLength(0);
    expect(result.ruleViolations).toEqual([]);
  });

  it('reports a check that cannot be evaluated as an error without judging', async () => {
    const { context } = setup([{ ...gated, check: '$notAFunction(' }]);
    const judge = new FakeJudgeProvider();
    const result = await validateSpace(context(), { judge });
    expect(judge.callHistory).toHaveLength(0);
    expect(result.ruleViolations[0]).toMatchObject({ file: 'S.md', severity: 'error' });
    expect(result.ruleViolations[0]?.description).toContain('Rule error');
  });
});
