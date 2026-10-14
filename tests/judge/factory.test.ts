import { describe, expect, it } from 'bun:test';
import { createJudge, createModelProvider, JudgeConfigError } from '../../src/judge/factory';
import { AnthropicJudgeProvider } from '../../src/judge/provider/anthropic';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { OpenAIJudgeProvider } from '../../src/judge/provider/openai';

describe('createModelProvider', () => {
  it('creates FakeJudgeProvider for type "fake"', () => {
    expect(createModelProvider('f', { type: 'fake' }, {}) instanceof FakeJudgeProvider).toBe(true);
  });

  it.each([
    ['anthropic', 'ANTHROPIC_API_KEY', AnthropicJudgeProvider],
    ['openai', 'OPENAI_API_KEY', OpenAIJudgeProvider],
    ['jev', 'OPENROUTER_API_KEY', JevJudgeProvider],
  ] as const)('creates %s with its usual env key (%s)', (type, keyEnv, Class) => {
    expect(createModelProvider('p', { type }, { [keyEnv]: 'k' }) instanceof Class).toBe(true);
  });

  it('reads the key from the variable named by apiKeyEnv', () => {
    const def = { type: 'jev', apiKeyEnv: 'MY_JEV_KEY' } as const;
    expect(createModelProvider('p', def, { MY_JEV_KEY: 'k' }) instanceof JevJudgeProvider).toBe(true);
    expect(() => createModelProvider('p', def, { OPENROUTER_API_KEY: 'k' })).toThrow('MY_JEV_KEY');
  });

  it("does not borrow another provider's key", () => {
    expect(() => createModelProvider('p', { type: 'anthropic' }, { OPENAI_API_KEY: 'o' })).toThrow('ANTHROPIC_API_KEY');
    expect(() => createModelProvider('p', { type: 'jev' }, { ANTHROPIC_API_KEY: 'a' })).toThrow('OPENROUTER_API_KEY');
  });

  it('lets openai run without a key for local endpoints', () => {
    const provider = createModelProvider('local', { type: 'openai', endpoint: 'http://localhost:11434/v1' }, {});
    expect(provider instanceof OpenAIJudgeProvider).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(() => createModelProvider('p', { type: 'gemini' as never }, {})).toThrow('unknown type "gemini"');
  });
});

describe('createJudge', () => {
  const config = {
    modelProviders: { jev: { type: 'jev' }, claude: { type: 'anthropic' } } as const,
    judge: { provider: 'claude' },
  };
  const env = { OPENROUTER_API_KEY: 'r', ANTHROPIC_API_KEY: 'a' };

  it('uses the top-level judge provider', () => {
    expect(createJudge(config, {}, undefined, env).name).toBe('anthropic');
  });

  it("uses the space's judge over the top-level one, and a run's over both", () => {
    const space = { judge: { provider: 'jev' } };
    expect(createJudge(config, space, undefined, env).name).toBe('jev');
    expect(createJudge(config, space, 'claude', env).name).toBe('anthropic');
  });

  it('never infers a provider from API keys in the environment', () => {
    const keys = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'r' };
    expect(() => createJudge({}, {}, undefined, keys)).toThrow(JudgeConfigError);
    expect(() => createJudge({ modelProviders: config.modelProviders }, {}, undefined, keys)).toThrow(
      'No judge configured',
    );
  });

  it('rejects a provider name that is not configured, listing what is', () => {
    expect(() => createJudge(config, {}, 'nope', env)).toThrow('Configured: jev, claude');
  });

  it('fails when the chosen provider has no key', () => {
    expect(() => createJudge(config, {}, undefined, { OPENROUTER_API_KEY: 'r' })).toThrow('ANTHROPIC_API_KEY');
  });
});
