import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { verdictCachePath, withVerdictCache } from '../../src/judge/cache';
import { AnthropicJudgeProvider } from '../../src/judge/provider/anthropic';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { OpenAIJudgeProvider } from '../../src/judge/provider/openai';
import { OpenAIDecisionsJudgeProvider } from '../../src/judge/provider/openai-decisions';
import type {
  JudgeProviderIdentity,
  SemanticJudgeInput,
  SemanticJudgeProvider,
  SemanticJudgeResult,
  SemanticRuleSpec,
} from '../../src/judge/types';
import { createSpaceContext } from '../../src/space-context';
import type { NodeId, SchemaWithMetadata } from '../../src/types';
import { validateSpace } from '../../src/validate';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'sctx-vcache-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const dummySchema: SchemaWithMetadata = { type: 'object', metadata: {} };

const ruleA: SemanticRuleSpec = {
  id: 'rule-a',
  description: 'Check A',
  rubric: 'Is A good?',
  category: 'best-practice',
  verdicts: { pass: 'Good', fail: 'Bad' },
};

const ruleB: SemanticRuleSpec = {
  id: 'rule-b',
  description: 'Check B',
  rubric: 'Is B good?',
  category: 'coherence',
  verdicts: { pass: 'Coherent', fail: 'Incoherent' },
};

function makeInput(id: string, title: string, rules: SemanticRuleSpec[] = [ruleA]): SemanticJudgeInput {
  return {
    node: {
      id: id as NodeId,
      title,
      resolvedType: 'opportunity',
      schemaData: { status: 'active', content: `Secret body of ${title}` },
      parentTitles: ['Goal 1'],
    },
    rules,
  };
}

function makeContext(configDir: string, spaceName: string) {
  return { configDir, space: { name: spaceName, path: configDir }, schema: dummySchema };
}

class SpyProvider implements SemanticJudgeProvider {
  readonly name = 'spy';
  readonly identity: JudgeProviderIdentity;
  calls: SemanticJudgeInput[][] = [];

  constructor(
    private handler: (input: SemanticJudgeInput) => Record<string, SemanticJudgeResult>,
    identity: JudgeProviderIdentity = {
      api: 'openrouter-decisions',
      model: 'jev-test',
      endpoint: 'https://example.test',
    },
  ) {
    this.identity = identity;
  }

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    this.calls.push([input]);
    return this.handler(input);
  }

  async evaluateNodes(inputs: SemanticJudgeInput[]): Promise<Array<Record<string, SemanticJudgeResult>>> {
    this.calls.push(inputs);
    return inputs.map((input) => this.handler(input));
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('verdict cache', () => {
  test('second run makes zero provider calls and never persists judge input', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const ctx = makeContext(configDir, 'my-space');
    const spy = new SpyProvider((input) =>
      Object.fromEntries(input.rules.map((r) => [r.id, { verdict: 'pass', confidence: 0.92, evidence: 'ok' }])),
    );

    const inputs = [makeInput('a.md', 'Alpha', [ruleA, ruleB]), makeInput('b.md', 'Beta', [ruleA])];
    const opts = { cacheDir, pluginSource: 'sctx-markdown' };

    const res1 = await withVerdictCache(spy, ctx, opts).evaluateNodes!(inputs);
    expect(spy.calls).toHaveLength(1);
    expect(res1[0]?.['rule-a']).toEqual({ verdict: 'pass', confidence: 0.92, evidence: 'ok' });

    const res2 = await withVerdictCache(spy, ctx, opts).evaluateNodes!(inputs);
    expect(spy.calls).toHaveLength(1);
    expect(res2).toEqual(res1);

    const raw = readFileSync(verdictCachePath(cacheDir, configDir, 'my-space'), 'utf-8');
    expect(raw).not.toContain('Secret body of Alpha');
    expect(raw).not.toContain('Alpha');
    const entries = Object.values(JSON.parse(raw).entries) as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.coreVersion).toBe('string');
      expect(typeof entry.pluginVersion).toBe('string');
      expect(typeof entry.schemaHash).toBe('string');
      expect(entry.verdict).toBeDefined();
    }
  });

  test('re-judges only changed nodes and changed rules', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const ctx = makeContext(configDir, 'space-a');
    const spy = new SpyProvider((input) =>
      Object.fromEntries(input.rules.map((r) => [r.id, { verdict: 'pass', evidence: `judged ${input.node.title}` }])),
    );

    await withVerdictCache(spy, ctx, { cacheDir }).evaluateNodes!([
      makeInput('a.md', 'Alpha', [ruleA, ruleB]),
      makeInput('b.md', 'Beta', [ruleA, ruleB]),
    ]);
    expect(spy.calls).toHaveLength(1);

    const ruleBEdited: SemanticRuleSpec = { ...ruleB, rubric: 'Is B very good?' };
    await withVerdictCache(spy, ctx, { cacheDir }).evaluateNodes!([
      makeInput('a.md', 'Alpha', [ruleA, ruleBEdited]),
      makeInput('b.md', 'Beta Changed', [ruleA, ruleBEdited]),
    ]);

    expect(spy.calls).toHaveLength(2);
    const secondCall = spy.calls[1]!;
    expect(secondCall).toHaveLength(2);
    expect(secondCall[0]!.node.id).toBe('a.md' as NodeId);
    expect(secondCall[0]!.rules.map((r) => r.id)).toEqual(['rule-b']);
    expect(secondCall[1]!.node.id).toBe('b.md' as NodeId);
    expect(secondCall[1]!.rules.map((r) => r.id)).toEqual(['rule-a', 'rule-b']);
  });

  test('never caches provider errors or unknown verdicts', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const ctx = makeContext(configDir, 'space-err');
    let attempt = 0;
    const spy = new SpyProvider(() => {
      attempt++;
      if (attempt === 1) {
        return { 'rule-a': { error: 'rate limited' }, 'rule-b': { verdict: 'not-a-valid-verdict' } };
      }
      return { 'rule-a': { verdict: 'pass' }, 'rule-b': { verdict: 'fail' } };
    });

    const first = await withVerdictCache(spy, ctx, { cacheDir }).evaluate(makeInput('a.md', 'Alpha', [ruleA, ruleB]));
    expect(first['rule-a']).toEqual({ error: 'rate limited' });
    expect(existsSync(verdictCachePath(cacheDir, configDir, 'space-err'))).toBe(false);

    const second = await withVerdictCache(spy, ctx, { cacheDir }).evaluate(makeInput('a.md', 'Alpha', [ruleA, ruleB]));
    expect(second['rule-a']).toEqual({ verdict: 'pass' });
    expect(second['rule-b']).toEqual({ verdict: 'fail' });
    expect(attempt).toBe(2);
  });

  test('rejudge bypasses cache reads and overwrites cached verdicts', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const ctx = makeContext(configDir, 'space-rejudge');
    let verdict: 'pass' | 'fail' = 'pass';
    const spy = new SpyProvider(() => ({ 'rule-a': { verdict } }));
    const input = makeInput('a.md', 'Alpha', [ruleA]);

    await withVerdictCache(spy, ctx, { cacheDir }).evaluate(input);
    expect(spy.calls).toHaveLength(1);

    verdict = 'fail';
    const rejudged = await withVerdictCache(spy, ctx, { cacheDir, rejudge: true }).evaluate(input);
    expect(spy.calls).toHaveLength(2);
    expect(rejudged['rule-a']).toEqual({ verdict: 'fail' });

    const after = await withVerdictCache(spy, ctx, { cacheDir }).evaluate(input);
    expect(spy.calls).toHaveLength(2);
    expect(after['rule-a']).toEqual({ verdict: 'fail' });
  });

  test('model change misses cache', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const ctx = makeContext(configDir, 'space-model');
    const spy1 = new SpyProvider(() => ({ 'rule-a': { verdict: 'pass' } }), {
      api: 'openrouter-decisions',
      model: 'v1',
    });
    const spy2 = new SpyProvider(() => ({ 'rule-a': { verdict: 'fail' } }), {
      api: 'openrouter-decisions',
      model: 'v2',
    });
    const input = makeInput('a.md', 'Alpha', [ruleA]);

    await withVerdictCache(spy1, ctx, { cacheDir }).evaluate(input);
    const res = await withVerdictCache(spy2, ctx, { cacheDir }).evaluate(input);
    expect(spy2.calls).toHaveLength(1);
    expect(res['rule-a']).toEqual({ verdict: 'fail' });
  });

  test('each real provider exposes a content-hashed promptVersion on its identity', () => {
    const providers = [
      new AnthropicJudgeProvider({ api: 'anthropic-messages', apiKey: 'k' }),
      new OpenAIJudgeProvider({ api: 'openai-completions' }),
      new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' }),
      new OpenAIDecisionsJudgeProvider({ api: 'openai-decisions', apiKey: 'k' }),
    ];
    for (const provider of providers) {
      expect(provider.identity.promptVersion).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(providers[0]!.identity.promptVersion).toBe(providers[1]!.identity.promptVersion);
    expect(providers[2]!.identity.promptVersion).not.toBe(providers[0]!.identity.promptVersion);
    expect(providers[3]!.identity.promptVersion).not.toBe(providers[2]!.identity.promptVersion);
  });

  test('corrupt cache file throws an error naming the file', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const path = verdictCachePath(cacheDir, configDir, 'corrupt-space');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{not valid json', 'utf-8');

    const spy = new SpyProvider(() => ({ 'rule-a': { verdict: 'pass' } }));
    const provider = withVerdictCache(spy, makeContext(configDir, 'corrupt-space'), { cacheDir });
    await expect(provider.evaluate(makeInput('a.md', 'Alpha', [ruleA]))).rejects.toThrow(path);
    expect(spy.calls).toHaveLength(0);
  });

  test('validateSpace uses verdict cache by default and skips it with cache: false', async () => {
    const root = makeTempDir('sctx-val-cache-');
    const cacheDir = makeTempDir('sctx-val-cache-dir-');
    const spaceDir = join(root, 'space');
    mkdirSync(spaceDir, { recursive: true });
    writeFileSync(
      join(spaceDir, 'opp.md'),
      '---\ntype: opportunity\ntitle: Slow checkout\nstatus: active\n---\nUsers wait too long.\n',
    );
    const schemaPath = join(root, 'schema.json');
    writeFileSync(
      schemaPath,
      JSON.stringify({
        type: 'object',
        required: ['type', 'title', 'status'],
        properties: { type: { const: 'opportunity' }, title: { type: 'string' }, status: { type: 'string' } },
        $metadata: {
          rules: [
            {
              id: 'check-opp',
              category: 'best-practice',
              type: 'opportunity',
              description: 'Check opportunity',
              semantic: {},
            },
          ],
        },
      }),
    );
    const config: Config = {
      modelProviders: { mock: { api: 'fake' } },
      semantic: { provider: 'mock' },
      spaces: [{ name: 's1', path: spaceDir, schema: schemaPath }],
    };
    const context = createSpaceContext('s1', config, { configDir: root });
    const expectedPath = verdictCachePath(cacheDir, root, 's1');

    await validateSpace(context, { semantic: true, cache: false, cacheDir });
    expect(existsSync(expectedPath)).toBe(false);

    await validateSpace(context, { semantic: true, cacheDir });
    expect(existsSync(expectedPath)).toBe(true);
  });
});
