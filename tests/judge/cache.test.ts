import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { CachedJudgeProvider, canonicalStringify, verdictCacheKey, verdictCachePath } from '../../src/judge/cache';
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

const dummySchema: SchemaWithMetadata = {
  type: 'object',
  metadata: {},
};

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

function makeInput(
  id: string,
  title: string,
  rules: SemanticRuleSpec[] = [ruleA],
  extra?: Partial<SemanticJudgeInput>,
): SemanticJudgeInput {
  return {
    node: {
      id: id as NodeId,
      title,
      resolvedType: 'opportunity',
      schemaData: { status: 'active', content: `Secret body of ${title}` },
      parentTitles: ['Goal 1'],
    },
    rules,
    ...extra,
  };
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
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('verdict cache', () => {
  test('canonicalStringify produces identical keys regardless of property insertion order', () => {
    const a = { z: 1, a: { c: 3, b: 2, omitted: undefined } };
    const b = { a: { b: 2, c: 3 }, z: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  test('second run makes zero provider calls and never persists judge input', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const spy = new SpyProvider((input) =>
      Object.fromEntries(input.rules.map((r) => [r.id, { verdict: 'pass', confidence: 0.92, evidence: 'ok' }])),
    );

    const opts = {
      configDir,
      spaceName: 'my-space',
      schema: dummySchema,
      cacheDir,
      pluginVersion: '0.25.0',
    };

    const inputs = [makeInput('a.md', 'Alpha', [ruleA, ruleB]), makeInput('b.md', 'Beta', [ruleA])];

    const first = new CachedJudgeProvider(spy, opts);
    const res1 = await first.evaluateNodes(inputs);
    expect(spy.calls).toHaveLength(1);
    expect(res1[0]?.['rule-a']).toEqual({ verdict: 'pass', confidence: 0.92, evidence: 'ok' });

    // New CachedJudgeProvider instance simulates a second CLI run reading from disk
    const second = new CachedJudgeProvider(spy, opts);
    const res2 = await second.evaluateNodes(inputs);
    expect(spy.calls).toHaveLength(1); // zero additional provider calls
    expect(res2).toEqual(res1);

    // Verify stored file has metadata and never contains node content or titles
    const raw = readFileSync(first.cachePath, 'utf-8');
    expect(raw).not.toContain('Secret body of Alpha');
    expect(raw).not.toContain('Alpha');
    const parsed = JSON.parse(raw);
    const entries = Object.values(parsed.entries) as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.coreVersion).toBe('string');
      expect(entry.pluginVersion).toBe('0.25.0');
      expect(typeof entry.schemaHash).toBe('string');
      expect(entry.verdict).toBeDefined();
    }
  });

  test('re-judges only changed nodes and changed rules', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const spy = new SpyProvider((input) =>
      Object.fromEntries(input.rules.map((r) => [r.id, { verdict: 'pass', evidence: `judged ${input.node.title}` }])),
    );
    const opts = { configDir, spaceName: 'space-a', schema: dummySchema, cacheDir };

    const p1 = new CachedJudgeProvider(spy, opts);
    await p1.evaluateNodes([makeInput('a.md', 'Alpha', [ruleA, ruleB]), makeInput('b.md', 'Beta', [ruleA, ruleB])]);
    expect(spy.calls).toHaveLength(1);

    // Edit Beta's content and edit ruleB's rubric; Alpha + ruleA should still hit cache
    const ruleBEdited: SemanticRuleSpec = { ...ruleB, rubric: 'Is B very good?' };
    const p2 = new CachedJudgeProvider(spy, opts);
    await p2.evaluateNodes([
      makeInput('a.md', 'Alpha', [ruleA, ruleBEdited]),
      makeInput('b.md', 'Beta Changed', [ruleA, ruleBEdited]),
    ]);

    expect(spy.calls).toHaveLength(2);
    const secondCall = spy.calls[1]!;
    expect(secondCall).toHaveLength(2);
    // Alpha only missed ruleBEdited
    expect(secondCall[0]!.node.id).toBe('a.md' as NodeId);
    expect(secondCall[0]!.rules.map((r) => r.id)).toEqual(['rule-b']);
    // Beta Changed missed both rules
    expect(secondCall[1]!.node.id).toBe('b.md' as NodeId);
    expect(secondCall[1]!.rules.map((r) => r.id)).toEqual(['rule-a', 'rule-b']);
  });

  test('never caches provider errors or unknown verdicts', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    let attempt = 0;
    const spy = new SpyProvider(() => {
      attempt++;
      if (attempt === 1) {
        return { 'rule-a': { error: 'rate limited' }, 'rule-b': { verdict: 'not-a-valid-verdict' } };
      }
      return { 'rule-a': { verdict: 'pass' }, 'rule-b': { verdict: 'fail' } };
    });
    const opts = { configDir, spaceName: 'space-err', schema: dummySchema, cacheDir };

    const p1 = new CachedJudgeProvider(spy, opts);
    const first = await p1.evaluate(makeInput('a.md', 'Alpha', [ruleA, ruleB]));
    expect(first['rule-a']).toEqual({ error: 'rate limited' });
    expect(existsSync(p1.cachePath)).toBe(false);

    const p2 = new CachedJudgeProvider(spy, opts);
    const second = await p2.evaluate(makeInput('a.md', 'Alpha', [ruleA, ruleB]));
    expect(second['rule-a']).toEqual({ verdict: 'pass' });
    expect(second['rule-b']).toEqual({ verdict: 'fail' });
    expect(attempt).toBe(2);
  });

  test('rejudge bypasses cache reads and overwrites cached verdicts', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    let verdict: 'pass' | 'fail' = 'pass';
    const spy = new SpyProvider(() => ({ 'rule-a': { verdict } }));
    const opts = { configDir, spaceName: 'space-rejudge', schema: dummySchema, cacheDir };

    const input = makeInput('a.md', 'Alpha', [ruleA]);
    await new CachedJudgeProvider(spy, opts).evaluate(input);
    expect(spy.calls).toHaveLength(1);

    verdict = 'fail';
    const rejudged = await new CachedJudgeProvider(spy, { ...opts, rejudge: true }).evaluate(input);
    expect(spy.calls).toHaveLength(2);
    expect(rejudged['rule-a']).toEqual({ verdict: 'fail' });

    // Subsequent normal run sees the updated verdict without calling the provider
    const after = await new CachedJudgeProvider(spy, opts).evaluate(input);
    expect(spy.calls).toHaveLength(2);
    expect(after['rule-a']).toEqual({ verdict: 'fail' });
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
    // Chat providers share the chat prompt hash; decision providers each hash their own wire format.
    expect(providers[0]!.identity.promptVersion).toBe(providers[1]!.identity.promptVersion);
    expect(providers[2]!.identity.promptVersion).not.toBe(providers[0]!.identity.promptVersion);
    expect(providers[3]!.identity.promptVersion).not.toBe(providers[2]!.identity.promptVersion);
  });

  test('model change produces a different cache key', () => {
    const input = makeInput('a.md', 'Alpha', [ruleA]);
    const k1 = verdictCacheKey(input, ruleA, { api: 'openrouter-decisions', model: 'jev-v1' });
    const k2 = verdictCacheKey(input, ruleA, { api: 'openrouter-decisions', model: 'jev-v2' });
    expect(k1).not.toBe(k2);
  });

  test('corrupt cache file throws an error naming the file', async () => {
    const cacheDir = makeTempDir();
    const configDir = makeTempDir();
    const path = verdictCachePath(cacheDir, configDir, 'corrupt-space');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{not valid json', 'utf-8');

    const spy = new SpyProvider(() => ({ 'rule-a': { verdict: 'pass' } }));
    const provider = new CachedJudgeProvider(spy, {
      configDir,
      spaceName: 'corrupt-space',
      schema: dummySchema,
      cacheDir,
    });
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

    // cache: false writes nothing
    await validateSpace(context, { semantic: true, cache: false, cacheDir });
    expect(existsSync(expectedPath)).toBe(false);

    // default (cache: true) writes the partition file
    await validateSpace(context, { semantic: true, cacheDir });
    expect(existsSync(expectedPath)).toBe(true);
  });
});
