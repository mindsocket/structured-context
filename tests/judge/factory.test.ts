import { describe, expect, it } from 'bun:test';
import { createJudgeProvider, JudgeConfigError } from '../../src/judge/factory';
import { AnthropicJudgeProvider } from '../../src/judge/provider/anthropic';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { OpenAIJudgeProvider } from '../../src/judge/provider/openai';

describe('createJudgeProvider factory', () => {
  it('returns a custom provider when passed directly', () => {
    const custom = new FakeJudgeProvider();
    expect(createJudgeProvider(undefined, {}, custom)).toBe(custom);
  });

  it('creates FakeJudgeProvider when provider is "fake"', () => {
    const provider = createJudgeProvider({ provider: 'fake' }, {});
    expect(provider instanceof FakeJudgeProvider).toBe(true);
  });

  it.each([
    ['anthropic', 'ANTHROPIC_API_KEY', AnthropicJudgeProvider],
    ['openai', 'OPENAI_API_KEY', OpenAIJudgeProvider],
    ['jev', 'OPENROUTER_API_KEY', JevJudgeProvider],
  ] as const)('creates %s from config provider with its usual env key (%s)', (provider, keyEnv, Class) => {
    expect(createJudgeProvider({ provider }, { [keyEnv]: 'k' }) instanceof Class).toBe(true);
  });

  it('takes the provider from SCTX_JUDGE_PROVIDER and the key from config', () => {
    const provider = createJudgeProvider({ apiKey: 'k' }, { SCTX_JUDGE_PROVIDER: 'anthropic' });
    expect(provider.name).toBe('anthropic');
  });

  it('never infers a provider from API keys in the environment', () => {
    const env = {
      ANTHROPIC_API_KEY: 'a',
      OPENAI_API_KEY: 'o',
      OPENROUTER_API_KEY: 'r',
      OPENAI_BASE_URL: 'http://x/v1',
    };
    expect(() => createJudgeProvider(undefined, env)).toThrow(JudgeConfigError);
    expect(() => createJudgeProvider({ model: 'm' }, env)).toThrow('No semantic judge provider configured');
  });

  it("does not borrow another provider's key", () => {
    expect(() => createJudgeProvider({ provider: 'anthropic' }, { OPENAI_API_KEY: 'o' })).toThrow('ANTHROPIC_API_KEY');
    expect(() => createJudgeProvider({ provider: 'jev' }, { ANTHROPIC_API_KEY: 'a' })).toThrow('OPENROUTER_API_KEY');
  });

  it('lets openai run without a key for local endpoints', () => {
    const provider = createJudgeProvider({ provider: 'openai', endpoint: 'http://localhost:11434/v1' }, {});
    expect(provider instanceof OpenAIJudgeProvider).toBe(true);
  });

  it('rejects an unknown provider', () => {
    expect(() => createJudgeProvider({ provider: 'gemini' as never }, {})).toThrow('Unknown semantic judge provider');
  });
});
