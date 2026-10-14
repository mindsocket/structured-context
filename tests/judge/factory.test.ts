import { describe, expect, it } from 'bun:test';
import { createJudge, createJudgeProvider, JudgeConfigError } from '../../src/judge/factory';
import { AnthropicJudgeProvider } from '../../src/judge/provider/anthropic';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { OpenAIJudgeProvider } from '../../src/judge/provider/openai';
import type { Rule } from '../../src/types';
import { graded, node, passFailRule } from './helpers';

describe('createJudgeProvider factory', () => {
  it('returns a custom provider when passed directly', () => {
    const custom = new FakeJudgeProvider();
    expect(createJudgeProvider(undefined, {}, custom)).toBe(custom);
  });

  it('creates FakeJudgeProvider when provider is "fake"', () => {
    expect(createJudgeProvider({ type: 'fake' }, {}) instanceof FakeJudgeProvider).toBe(true);
  });

  it.each([
    ['anthropic', 'ANTHROPIC_API_KEY', AnthropicJudgeProvider],
    ['openai', 'OPENAI_API_KEY', OpenAIJudgeProvider],
    ['jev', 'OPENROUTER_API_KEY', JevJudgeProvider],
  ] as const)('creates %s from config provider with its usual env key (%s)', (provider, keyEnv, Class) => {
    expect(createJudgeProvider({ type: provider }, { [keyEnv]: 'k' }) instanceof Class).toBe(true);
  });

  it('never takes the provider type from the environment', () => {
    expect(() => createJudgeProvider({ apiKey: 'k' }, { SCTX_JUDGE_PROVIDER: 'anthropic' })).toThrow(
      'No semantic judge configured',
    );
  });

  it('reads the key from the variable named by apiKeyEnv', () => {
    const config = { type: 'jev', apiKeyEnv: 'MY_JEV_KEY' };
    expect(createJudgeProvider(config, { MY_JEV_KEY: 'k' }) instanceof JevJudgeProvider).toBe(true);
    expect(() => createJudgeProvider(config, { OPENROUTER_API_KEY: 'k' })).toThrow('MY_JEV_KEY');
  });

  it('never infers a provider from API keys in the environment', () => {
    const env = {
      ANTHROPIC_API_KEY: 'a',
      OPENAI_API_KEY: 'o',
      OPENROUTER_API_KEY: 'r',
      OPENAI_BASE_URL: 'http://x/v1',
    };
    expect(() => createJudgeProvider(undefined, env)).toThrow(JudgeConfigError);
    expect(() => createJudgeProvider({ model: 'm' }, env)).toThrow('No semantic judge configured');
  });

  it("does not borrow another provider's key", () => {
    expect(() => createJudgeProvider({ type: 'anthropic' }, { OPENAI_API_KEY: 'o' })).toThrow('ANTHROPIC_API_KEY');
    expect(() => createJudgeProvider({ type: 'jev' }, { ANTHROPIC_API_KEY: 'a' })).toThrow('OPENROUTER_API_KEY');
  });

  it('lets openai run without a key for local endpoints', () => {
    const provider = createJudgeProvider({ type: 'openai', endpoint: 'http://localhost:11434/v1' }, {});
    expect(provider instanceof OpenAIJudgeProvider).toBe(true);
  });

  it('treats provider "none" as an inert placeholder and rejects unknown providers', () => {
    expect(() => createJudgeProvider({ type: 'none' }, {})).toThrow('no provider type');
    expect(() => createJudgeProvider({ type: 'gemini' as never }, {})).toThrow('Unknown judge provider');
  });
});

describe('named providers and routing', () => {
  const config = {
    providers: { decision: { type: 'jev' }, llm: { type: 'anthropic', model: 'claude-haiku-5-5' } },
    default: 'llm',
  };
  const env = { OPENROUTER_API_KEY: 'r', ANTHROPIC_API_KEY: 'a' };

  it('uses the default provider unless the rule names one', () => {
    const judge = createJudge(config, env);
    expect(judge.resolve().name).toBe('anthropic');
    expect(judge.resolve('decision').name).toBe('jev');
  });

  it('lets a run-level override replace every rule choice', () => {
    expect(createJudge(config, env, undefined, 'decision').resolve('llm').name).toBe('jev');
  });

  it('needs `default` when several providers are configured and a rule names none', () => {
    expect(() => createJudge({ providers: config.providers }, env).resolve()).toThrow('judge.default');
  });

  it('uses the only configured provider as the default', () => {
    expect(createJudge({ providers: { llm: { type: 'anthropic' } } }, env).resolve().name).toBe('anthropic');
  });

  it('rejects a name that is not configured, listing what is', () => {
    expect(() => createJudge(config, env).resolve('nope')).toThrow('Configured: decision, llm');
  });

  it('creates providers lazily, so an unused one needs no key', () => {
    const judge = createJudge(config, { ANTHROPIC_API_KEY: 'a' });
    expect(judge.resolve().name).toBe('anthropic');
    expect(() => judge.resolve('decision')).toThrow('OPENROUTER_API_KEY');
  });

  it('prepare() fails before any request when a rule names an unusable judge', () => {
    const rule = { id: 'r', category: 'best-practice', description: 'd', mode: 'semantic', judge: 'decision' } as Rule;
    expect(() => createJudge(config, { ANTHROPIC_API_KEY: 'a' }).prepare([rule])).toThrow(JudgeConfigError);
    expect(() => createJudge(config, env).prepare([rule])).not.toThrow();
  });

  it('sends each rule to the provider it names, in one call per provider', async () => {
    const a = new FakeJudgeProvider({ 'customer-voice': { verdict: 'pass' } });
    const b = new FakeJudgeProvider({ framing: { verdict: 'good' } });
    const judge = createJudge({ type: 'fake' }, {});
    // Swap in recording providers for the two names.
    const routed = Object.assign(judge, {
      resolve: (name?: string) => (name === 'b' ? b : a),
    });
    const results = await routed.evaluate({
      node,
      rules: [{ ...passFailRule }, { ...graded, judge: 'b' }],
    });
    expect(results['customer-voice']).toEqual({ verdict: 'pass' });
    expect(results.framing).toEqual({ verdict: 'good' });
    expect(a.callHistory.map((c) => c.rules.map((r) => r.id))).toEqual([['customer-voice']]);
    expect(b.callHistory.map((c) => c.rules.map((r) => r.id))).toEqual([['framing']]);
  });
});
