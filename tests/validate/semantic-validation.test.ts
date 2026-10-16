import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { bundledSchemasDir } from '../../src/schema/schema';
import { createSpaceContext } from '../../src/space-context';
import type { FileValidationResult } from '../../src/types';
import { validateFile, validateSpace } from '../../src/validate';
import { makeTempSpace, type TempSpace } from '../helpers/temp-space';

const STRICT_SCHEMA_PATH = join(bundledSchemasDir, 'strict_ost.json');
const VALID_DIR = join(import.meta.dir, '../fixtures/strict_ost/valid-directory');
const INVALID_DIR = join(import.meta.dir, '../fixtures/strict_ost/invalid');

describe('Semantic rule evaluation integration (validateSpace & validateFile)', () => {
  const validConfig: Config = {
    spaces: [
      {
        name: 'strict-valid',
        path: VALID_DIR,
        schema: STRICT_SCHEMA_PATH,
      },
    ],
  };

  const validContext = createSpaceContext('strict-valid', validConfig, { configDir: import.meta.dir });

  describe('validateSpace', () => {
    it('skips semantic rules without a judge (deterministic & free)', async () => {
      const result = await validateSpace(validContext);
      expect(result.ruleViolations.some((v) => v.ruleId === 'opportunity-customer-voice')).toBe(false);
    });

    it('evaluates semantic rules when a judge is passed', async () => {
      const fakeProvider = new FakeJudgeProvider({
        pass: true,
        evidence: 'Opportunity is framed in clear customer language describing difficulty with sign-up.',
      });

      const result = await validateSpace(validContext, {
        judge: fakeProvider,
      });

      expect(fakeProvider.callHistory.some((c) => c.rules.some((r) => r.id === 'opportunity-customer-voice'))).toBe(
        true,
      );

      // No violation when the verdict has no severity
      expect(result.ruleViolations.some((v) => v.ruleId === 'opportunity-customer-voice')).toBe(false);
    });

    it('records violation with evidence when judge returns pass: false', async () => {
      const fakeProvider = new FakeJudgeProvider({
        pass: false,
        evidence: 'The opportunity reads like a feature request rather than a problem statement.',
      });

      const result = await validateSpace(validContext, {
        judge: fakeProvider,
      });

      const violation = result.ruleViolations.find((v) => v.ruleId === 'opportunity-customer-voice');
      expect(violation).toBeDefined();
      expect(violation?.category).toBe('best-practice');
      expect(violation?.evidence).toBe('The opportunity reads like a feature request rather than a problem statement.');
      expect(violation?.file).toBe('Sign-up is too complex.md');
    });

    it('gates semantic rules when node has upstream structural errors (cascading)', async () => {
      const invalidConfig: Config = {
        spaces: [
          {
            name: 'strict-invalid',
            path: INVALID_DIR,
            schema: STRICT_SCHEMA_PATH,
          },
        ],
      };
      const invalidContext = createSpaceContext('strict-invalid', invalidConfig, { configDir: import.meta.dir });
      const fakeProvider = new FakeJudgeProvider();

      const result = await validateSpace(invalidContext, {
        judge: fakeProvider,
      });

      // opportunity-no-source.md fails schema validation (missing required 'source' field)
      expect(result.nodeErrors.some((e) => e.file === 'opportunity-no-source.md')).toBe(true);

      // Therefore it must be gated and never evaluated by the judge
      expect(result.coverageGates.some((g) => g.file === 'opportunity-no-source.md' && g.reason === 'schema')).toBe(
        true,
      );
      // Judge was never called for opportunity-no-source.md
      expect(fakeProvider.callHistory.some((c) => c.node.label === 'opportunity-no-source.md')).toBe(false);
    });
  });

  describe('validateFile', () => {
    const targetFile = join(VALID_DIR, 'Sign-up is too complex.md');

    it('skips semantic rule evaluation for single file by default', async () => {
      const result = (await validateFile(targetFile, validConfig, {
        configDir: import.meta.dir,
      })) as FileValidationResult;

      expect(result.inSpace).toBe(true);
      expect(result.errors['rule:opportunity-customer-voice']).toBeUndefined();
    });

    it('evaluates semantic rule and reports evidence on violation when semantic: true', async () => {
      const failingProvider = new FakeJudgeProvider({
        pass: false,
        evidence: 'Opportunity is framed in solution space.',
      });

      const result = (await validateFile(targetFile, validConfig, {
        judge: failingProvider,
        configDir: import.meta.dir,
      })) as FileValidationResult;

      expect(result.inSpace).toBe(true);
      // best-practice rules default to non-error severity, so they land in warnings
      const ruleError = result.warnings['rule:opportunity-customer-voice'];
      expect(ruleError).toBeDefined();
      expect(ruleError?.kind).toBe('rule');
      expect(ruleError?.message).toContain('Evidence: Opportunity is framed in solution space.');
    });
  });
});

describe('validateFile judges only the target and its gate-capable ancestor rules', () => {
  let space: TempSpace;
  const rule = (id: string, type: string, severity: string) => ({
    id,
    type,
    semantic: {},
    category: 'validation',
    severity,
    description: id,
  });

  beforeAll(() => {
    space = makeTempSpace([
      rule('goal-sound', 'goal', 'error'), // gates descendants
      rule('task-sound', 'task', 'warning'), // does not gate
      rule('step-sound', 'step', 'warning'),
    ]);
  });
  afterAll(() => space.cleanup());

  const run = (judge: FakeJudgeProvider, file: string, extra = {}) =>
    validateFile(space.file(file), space.config, {
      judge: judge,
      configDir: space.dir,
      ...extra,
    }) as Promise<FileValidationResult>;

  it('judges the target plus only the gate-capable rules of its ancestors', async () => {
    const judge = new FakeJudgeProvider({ pass: true });
    await run(judge, 'S.md');
    const judged = judge.callHistory.map((c) => `${c.node.label}:${c.rules.map((r) => r.id).join(',')}`).sort();
    // G's rule can gate; T's cannot and Other is unrelated.
    expect(judged).toEqual(['G.md:goal-sound', 'S.md:step-sound']);
  });

  it('still lets a failing ancestor rule gate the target', async () => {
    const judge = new FakeJudgeProvider({ 'goal-sound': { verdict: 'fail' } });
    const result = await run(judge, 'S.md');
    expect(result.warnings['rule:step-sound']).toBeUndefined();
    expect(Object.keys(result.warnings).some((k) => k.startsWith('gated:'))).toBe(true);
    expect(judge.callHistory.some((c) => c.node.label === 'S.md')).toBe(false);
  });

  it('with includeGated judges the target even when an ancestor fails', async () => {
    const judge = new FakeJudgeProvider({ 'goal-sound': { verdict: 'fail' }, 'step-sound': { verdict: 'fail' } });
    const result = await run(judge, 'S.md', { includeGated: true });
    expect(result.warnings['rule:step-sound']).toBeDefined();
  });

  it('judges nothing when the filter excludes every semantic rule', async () => {
    const judge = new FakeJudgeProvider({ pass: true });
    await run(judge, 'S.md', { ruleFilter: { id: ['no-such-rule'] } });
    expect(judge.callHistory).toHaveLength(0);
  });
});

describe('Semantic rules: verdicts, batching and rule filter', () => {
  const config: Config = {
    spaces: [{ name: 'strict-valid', path: VALID_DIR, schema: STRICT_SCHEMA_PATH }],
  };
  const context = createSpaceContext('strict-valid', config, { configDir: import.meta.dir });

  it('judges each node once with all of its semantic rules', async () => {
    const fake = new FakeJudgeProvider();
    await validateSpace(context, { judge: fake });
    const labels = fake.callHistory.map((c) => c.node.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(fake.callHistory.every((c) => c.rules.length >= 1)).toBe(true);
  });

  it('reports a verdict that has a severity as a violation carrying the verdict and evidence', async () => {
    const fake = new FakeJudgeProvider({ verdict: 'fail', confidence: 0.7, evidence: 'solution in disguise' });
    const result = await validateSpace(context, { judge: fake });
    const violation = result.ruleViolations.find((v) => v.ruleId === 'opportunity-customer-voice');
    expect(violation).toMatchObject({ verdict: 'fail', evidence: 'solution in disguise' });
  });

  it('reports a per-rule judge error as a violation without gating the subtree', async () => {
    const fake = new FakeJudgeProvider({ error: 'rate limited' });
    const result = await validateSpace(context, { judge: fake });
    const violation = result.ruleViolations.find((v) => v.ruleId === 'opportunity-customer-voice');
    expect(violation?.description).toContain('Semantic evaluation error: rate limited');
    expect(result.coverageGates.filter((g) => g.ruleId === 'opportunity-customer-voice')).toEqual([]);
  });

  it('--rule-filter narrows evaluation: filtering to the semantic rule runs no expression rules, filtering it out runs no judge', async () => {
    const semanticOnly = await validateSpace(context, {
      judge: new FakeJudgeProvider({ pass: false }),
      ruleFilter: { id: ['opportunity-customer-voice'] },
    });
    expect(semanticOnly.ruleViolations.every((v) => v.ruleId === 'opportunity-customer-voice')).toBe(true);

    const fake = new FakeJudgeProvider();
    const expressionOnly = await validateSpace(context, {
      judge: fake,
      ruleFilter: { category: ['workflow'] },
    });
    expect(fake.callHistory).toHaveLength(0);
    expect(expressionOnly.ruleViolations.some((v) => v.verdict !== undefined)).toBe(false);
  });
});
