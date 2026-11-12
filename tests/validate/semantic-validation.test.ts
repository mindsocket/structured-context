import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { PER_NODE_INPUT_CAP_TOKENS } from '../../src/judge/trim';
import { bundledSchemasDir } from '../../src/schema/schema';
import { createSpaceContext } from '../../src/space-context';
import type { FileValidationResult } from '../../src/types';
import { validateFile, validateSpace } from '../../src/validate';
import { ofKind, schemaFailures, withKey } from '../helpers/issues';
import { makeTempSpace, type TempSpace } from '../helpers/temp-space';
import { validateFileWith, validateSpaceWith } from '../helpers/validate-run';

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
      expect(ofKind(result.issues, 'rule').some((v) => v.ruleId === 'opportunity-customer-voice')).toBe(false);
    });

    it('evaluates semantic rules when a judge is passed', async () => {
      const provider = new FakeJudgeProvider({
        pass: true,
        evidence: 'Opportunity is framed in clear customer language describing difficulty with sign-up.',
      });

      const result = await validateSpaceWith(validContext, {
        judge: { provider },
      });

      expect(provider.callHistory.some((c) => c.rules.some((r) => r.id === 'opportunity-customer-voice'))).toBe(true);

      // No violation when the verdict has no severity
      expect(ofKind(result.issues, 'rule').some((v) => v.ruleId === 'opportunity-customer-voice')).toBe(false);
    });

    it("sends the schema's descriptions of each judged node type", async () => {
      const provider = new FakeJudgeProvider({ pass: true });
      await validateSpaceWith(validContext, { judge: { provider } });
      const call = provider.callHistory.find((c) => c.rules.some((r) => r.id === 'opportunity-customer-voice'));
      expect(call?.schemaDescriptions?.opportunity?.fields?.source).toContain('Customer research source');
    });

    it('records violation with evidence when judge returns pass: false', async () => {
      const provider = new FakeJudgeProvider({
        pass: false,
        evidence: 'The opportunity reads like a feature request rather than a problem statement.',
      });

      const result = await validateSpaceWith(validContext, {
        judge: { provider },
      });

      const violation = ofKind(result.issues, 'rule').find((v) => v.ruleId === 'opportunity-customer-voice');
      expect(violation).toBeDefined();
      expect(violation?.category).toBe('best-practice');
      expect(violation?.evidence).toBe('The opportunity reads like a feature request rather than a problem statement.');
      expect(violation?.nodeId as string | undefined).toBe('Sign-up is too complex.md');
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
      const provider = new FakeJudgeProvider();

      const result = await validateSpaceWith(invalidContext, {
        judge: { provider },
      });

      // opportunity-no-source.md fails schema validation (missing required 'source' field)
      expect(schemaFailures(result.issues) > 0).toBe(true);

      // Therefore it must be gated and never evaluated by the judge
      expect(ofKind(result.issues, 'gated').some((i) => i.nodeId === 'opportunity-no-source.md')).toBe(true);
      // Judge was never called for opportunity-no-source.md
      expect(provider.callHistory.some((c) => c.node.id === 'opportunity-no-source.md')).toBe(false);
    });
  });

  describe('validateFile', () => {
    const targetFile = join(VALID_DIR, 'Sign-up is too complex.md');

    it('skips semantic rule evaluation for single file by default', async () => {
      const result = (await validateFile(targetFile, validConfig, {
        configDir: import.meta.dir,
      })) as FileValidationResult;

      expect(result.inSpace).toBe(true);
      expect(withKey(result.issues, 'rule:opportunity-customer-voice')).toBeUndefined();
    });

    it('evaluates semantic rule and reports evidence on violation when semantic: true', async () => {
      const provider = new FakeJudgeProvider({
        pass: false,
        evidence: 'Opportunity is framed in solution space.',
      });

      const result = (await validateFileWith(targetFile, validConfig, {
        judge: { provider },
        configDir: import.meta.dir,
      })) as FileValidationResult;

      expect(result.inSpace).toBe(true);
      // best-practice rules default to non-error severity, so they land in warnings
      const ruleError = withKey(result.issues, 'rule:opportunity-customer-voice');
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

  const run = (provider: FakeJudgeProvider, file: string, extra = {}) =>
    validateFileWith(space.file(file), space.config, {
      judge: { provider },
      configDir: space.dir,
      ...extra,
    }) as Promise<FileValidationResult>;

  it('judges the target plus only the gate-capable rules of its ancestors', async () => {
    const provider = new FakeJudgeProvider({ pass: true });
    await run(provider, 'S.md');
    const judged = provider.callHistory.map((c) => `${c.node.id}:${c.rules.map((r) => r.id).join(',')}`).sort();
    // G's rule can gate; T's cannot and Other is unrelated.
    expect(judged).toEqual(['G.md:goal-sound', 'S.md:step-sound']);
  });

  it('still lets a failing ancestor rule gate the target', async () => {
    const provider = new FakeJudgeProvider({ 'goal-sound': { verdict: 'fail' } });
    const result = await run(provider, 'S.md');
    expect(withKey(result.issues, 'rule:step-sound')).toBeUndefined();
    expect(result.issues.some((issue) => issue.kind === 'gated')).toBe(true);
    expect(provider.callHistory.some((c) => c.node.id === 'S.md')).toBe(false);
  });

  it('with includeGated judges the target even when an ancestor fails', async () => {
    const provider = new FakeJudgeProvider({ 'goal-sound': { verdict: 'fail' }, 'step-sound': { verdict: 'fail' } });
    const result = await run(provider, 'S.md', { includeGated: true });
    expect(withKey(result.issues, 'rule:step-sound')).toBeDefined();
  });

  it('judges nothing when the filter excludes every semantic rule', async () => {
    const provider = new FakeJudgeProvider({ pass: true });
    await run(provider, 'S.md', { ruleFilter: { id: ['no-such-rule'] } });
    expect(provider.callHistory).toHaveLength(0);
  });
});

describe('Semantic rules: verdicts, batching and rule filter', () => {
  const config: Config = {
    spaces: [{ name: 'strict-valid', path: VALID_DIR, schema: STRICT_SCHEMA_PATH }],
  };
  const context = createSpaceContext('strict-valid', config, { configDir: import.meta.dir });

  it('judges each node once with all of its semantic rules', async () => {
    const provider = new FakeJudgeProvider();
    await validateSpaceWith(context, { judge: { provider } });
    const labels = provider.callHistory.map((c) => c.node.id);
    expect(new Set(labels).size).toBe(labels.length);
    expect(provider.callHistory.every((c) => c.rules.length >= 1)).toBe(true);
  });

  it('reports a verdict that has a severity as a violation carrying the verdict and evidence', async () => {
    const provider = new FakeJudgeProvider({ verdict: 'fail', confidence: 0.7, evidence: 'solution in disguise' });
    const result = await validateSpaceWith(context, { judge: { provider } });
    const violation = ofKind(result.issues, 'rule').find((v) => v.ruleId === 'opportunity-customer-voice');
    expect(violation).toMatchObject({ verdict: 'fail', evidence: 'solution in disguise' });
  });

  it('reports a per-rule judge error as a violation without gating the subtree', async () => {
    const provider = new FakeJudgeProvider({ error: 'rate limited' });
    const result = await validateSpaceWith(context, { judge: { provider } });
    const violation = ofKind(result.issues, 'rule').find((v) => v.ruleId === 'opportunity-customer-voice');
    expect(violation?.message).toContain('Semantic evaluation error: rate limited');
    expect(ofKind(result.issues, 'gated')).toEqual([]);
  });

  it('--rule-filter narrows evaluation: filtering to the semantic rule runs no expression rules, filtering it out runs no judge', async () => {
    const semanticOnly = await validateSpaceWith(context, {
      judge: { provider: new FakeJudgeProvider({ pass: false }) },
      ruleFilter: { id: ['opportunity-customer-voice'] },
    });
    expect(ofKind(semanticOnly.issues, 'rule').every((v) => v.ruleId === 'opportunity-customer-voice')).toBe(true);

    const provider = new FakeJudgeProvider();
    const expressionOnly = await validateSpaceWith(context, {
      judge: { provider },
      ruleFilter: { category: ['workflow'] },
    });
    expect(provider.callHistory).toHaveLength(0);
    expect(ofKind(expressionOnly.issues, 'rule').some((v) => v.verdict !== undefined)).toBe(false);
  });
});

describe('context trimming in a run', () => {
  const scopedRule = {
    id: 'task-fits-goal',
    category: 'coherence',
    description: 'The task serves its goal',
    type: 'task',
    semantic: { scope: ['parent'], includeContent: 'fullScope' },
  };
  let space: TempSpace;
  beforeAll(() => {
    space = makeTempSpace([scopedRule]);
    writeFileSync(space.file('G.md'), `---\ntype: goal\n---\n${'word '.repeat(PER_NODE_INPUT_CAP_TOKENS * 2)}\n`);
  });
  afterAll(() => space.cleanup());

  it('reports how many nodes were trimmed and for which rules', async () => {
    const context = createSpaceContext('ts', space.config, { configDir: space.dir });
    const result = await validateSpaceWith(context, { judge: { provider: new FakeJudgeProvider({ pass: true }) } });
    expect(result.contextTrimmed).toEqual({ nodeCount: 1, ruleIds: ['task-fits-goal'] });
  });

  it('reports nothing without a judge', async () => {
    const context = createSpaceContext('ts', space.config, { configDir: space.dir });
    expect((await validateSpace(context)).contextTrimmed).toEqual({ nodeCount: 0, ruleIds: [] });
  });
});
