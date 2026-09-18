import { describe, expect, it } from 'bun:test';
import { AnthropicJudgeProvider } from '../../src/judge/anthropic';
import { createJudgeProvider } from '../../src/judge/factory';
import { FakeJudgeProvider } from '../../src/judge/fake';
import { OpenAIJudgeProvider } from '../../src/judge/openai';

describe('createJudgeProvider factory', () => {
  it('returns custom provider when passed directly', () => {
    const custom = new FakeJudgeProvider();
    const provider = createJudgeProvider(undefined, {}, custom);
    expect(provider).toBe(custom);
  });

  it('creates FakeJudgeProvider when provider is "fake"', () => {
    const provider = createJudgeProvider({ provider: 'fake' }, {});
    expect(provider.name).toBe('fake');
    expect(provider instanceof FakeJudgeProvider).toBe(true);
  });

  it('creates AnthropicJudgeProvider when ANTHROPIC_API_KEY is in env', () => {
    const provider = createJudgeProvider(undefined, { ANTHROPIC_API_KEY: 'test-key' });
    expect(provider.name).toBe('anthropic');
    expect(provider instanceof AnthropicJudgeProvider).toBe(true);
  });

  it('creates AnthropicJudgeProvider from config apiKey', () => {
    const provider = createJudgeProvider({ provider: 'anthropic', apiKey: 'test-key-config' }, {});
    expect(provider.name).toBe('anthropic');
  });

  it('creates OpenAIJudgeProvider when OPENAI_API_KEY is in env', () => {
    const provider = createJudgeProvider(undefined, { OPENAI_API_KEY: 'test-openai-key' });
    expect(provider.name).toBe('openai');
    expect(provider instanceof OpenAIJudgeProvider).toBe(true);
  });

  it('creates OpenAIJudgeProvider from OPENAI_BASE_URL (for local endpoints like Ollama)', () => {
    const provider = createJudgeProvider(undefined, { OPENAI_BASE_URL: 'http://localhost:11434/v1' });
    expect(provider.name).toBe('openai');
  });

  it('throws descriptive error when no provider or key is configured', () => {
    expect(() => createJudgeProvider(undefined, {})).toThrow('No semantic judge provider configured');
  });
});
