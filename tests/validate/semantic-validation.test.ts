import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { bundledSchemasDir } from '../../src/schema/schema';
import { createSpaceContext } from '../../src/space-context';
import type { FileValidationResult } from '../../src/types';
import { validateFile, validateSpace } from '../../src/validate';

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
    it('skips semantic rules by default (deterministic & free)', async () => {
      const result = await validateSpace(validContext);
      expect(result.semanticEvaluations ?? []).toHaveLength(0);
      expect(result.gatedRules ?? []).toHaveLength(0);
      expect(result.ruleViolations.some((v) => v.ruleId === 'opportunity-customer-voice')).toBe(false);
    });

    it('evaluates semantic rules when opt-in flag semantic: true is passed', async () => {
      const fakeProvider = new FakeJudgeProvider({
        pass: true,
        evidence: 'Opportunity is framed in clear customer language describing difficulty with sign-up.',
      });

      const result = await validateSpace(validContext, {
        semantic: true,
        judgeProvider: fakeProvider,
      });

      expect(result.semanticEvaluations).toBeDefined();
      expect(result.semanticEvaluations!.length).toBeGreaterThan(0);

      const oppEval = result.semanticEvaluations!.find((e) => e.ruleId === 'opportunity-customer-voice');
      expect(oppEval).toBeDefined();
      expect(oppEval?.pass).toBe(true);
      expect(oppEval?.evidence).toContain('framed in clear customer language');

      // No violation when pass is true
      expect(result.ruleViolations.some((v) => v.ruleId === 'opportunity-customer-voice')).toBe(false);
    });

    it('records violation with evidence when judge returns pass: false', async () => {
      const fakeProvider = new FakeJudgeProvider({
        pass: false,
        evidence: 'The opportunity reads like a feature request rather than a problem statement.',
      });

      const result = await validateSpace(validContext, {
        semantic: true,
        judgeProvider: fakeProvider,
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
        semantic: true,
        judgeProvider: fakeProvider,
      });

      // opportunity-no-source.md fails schema validation (missing required 'source' field)
      expect(result.nodeErrors.some((e) => e.file === 'opportunity-no-source.md')).toBe(true);

      // Therefore it must be gated and never evaluated by the judge
      expect(result.gatedRules).toBeDefined();
      const gated = result.gatedRules!.find(
        (g) => g.file === 'opportunity-no-source.md' && g.ruleId === 'opportunity-customer-voice',
      );
      expect(gated).toBeDefined();
      expect(gated?.reason).toMatch(/^Gated by/);

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
        semantic: true,
        judgeProvider: failingProvider,
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
  let dir: string;
  let config: Config;
  const typeSchema = (type: string, parent?: string) => ({
    type: 'object',
    properties: { type: { const: type }, title: { type: 'string' }, ...(parent && { parent: { type: 'string' } }) },
    required: ['type', 'title'],
  });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sctx-judge-target-'));
    const schemaPath = join(dir, 'schema.json');
    const rule = (id: string, type: string, severity: string) => ({
      id,
      type,
      mode: 'semantic',
      category: 'validation',
      severity,
      description: id,
    });
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema:
          'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json',
        $id: 'sctx://judge-target.test',
        $metadata: {
          hierarchy: { levels: ['goal', 'task', 'step'] },
          rules: [
            rule('goal-sound', 'goal', 'error'), // gates descendants
            rule('task-sound', 'task', 'warning'), // does not gate
            rule('step-sound', 'step', 'warning'),
          ],
        },
        oneOf: [typeSchema('goal'), typeSchema('task', 'p'), typeSchema('step', 'p')],
      }),
    );
    const space = join(dir, 'space');
    mkdirSync(space);
    writeFileSync(join(space, 'G.md'), '---\ntype: goal\n---\n');
    writeFileSync(join(space, 'T.md'), '---\ntype: task\nparent: "[[G]]"\n---\n');
    writeFileSync(join(space, 'S.md'), '---\ntype: step\nparent: "[[T]]"\n---\n');
    writeFileSync(join(space, 'Other.md'), '---\ntype: goal\n---\n');
    config = { spaces: [{ name: 'jt', path: space, schema: schemaPath }] };
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (judge: FakeJudgeProvider, file: string, extra = {}) =>
    validateFile(join(dir, 'space', file), config, {
      semantic: true,
      judgeProvider: judge,
      configDir: dir,
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
    await validateSpace(context, { semantic: true, judgeProvider: fake });
    const labels = fake.callHistory.map((c) => c.node.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(fake.callHistory.every((c) => c.rules.length >= 1)).toBe(true);
  });

  it('records the verdict and confidence on evaluations and fails only on failOn verdicts', async () => {
    const fake = new FakeJudgeProvider({ verdict: 'fail', confidence: 0.7, evidence: 'solution in disguise' });
    const result = await validateSpace(context, { semantic: true, judgeProvider: fake });
    const record = result.semanticEvaluations?.find((e) => e.ruleId === 'opportunity-customer-voice');
    expect(record).toMatchObject({ verdict: 'fail', pass: false, confidence: 0.7 });
    expect(result.ruleViolations.some((v) => v.ruleId === 'opportunity-customer-voice')).toBe(true);
  });

  it('reports a per-rule judge error as a violation without gating the subtree', async () => {
    const fake = new FakeJudgeProvider({ error: 'rate limited' });
    const result = await validateSpace(context, { semantic: true, judgeProvider: fake });
    const violation = result.ruleViolations.find((v) => v.ruleId === 'opportunity-customer-voice');
    expect(violation?.description).toContain('Judge error: rate limited');
    expect(result.coverageGates.filter((g) => g.ruleId === 'opportunity-customer-voice')).toEqual([]);
  });

  it('--rule-filter narrows evaluation: semantic-only runs no expression rules, expression-only runs no judge', async () => {
    const semanticOnly = await validateSpace(context, {
      semantic: true,
      judgeProvider: new FakeJudgeProvider({ pass: false }),
      ruleFilter: { mode: ['semantic'] },
    });
    expect(semanticOnly.ruleViolations.every((v) => v.ruleId === 'opportunity-customer-voice')).toBe(true);

    const fake = new FakeJudgeProvider();
    const expressionOnly = await validateSpace(context, {
      semantic: true,
      judgeProvider: fake,
      ruleFilter: { mode: ['expression'] },
    });
    expect(fake.callHistory).toHaveLength(0);
    expect(expressionOnly.semanticEvaluations ?? []).toHaveLength(0);
  });
});
