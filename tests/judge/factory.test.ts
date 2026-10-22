import { describe, expect, it } from 'bun:test';
import {
  createJudge,
  createModelProvider,
  hydrateProvider,
  JudgeConfigError,
  judgeForRun,
} from '../../src/judge/factory';
import { AnthropicJudgeProvider } from '../../src/judge/provider/anthropic';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { OpenAIJudgeProvider } from '../../src/judge/provider/openai';
import type { NodeId } from '../../src/types';
import { passFailRule } from './helpers';

describe('hydrateProvider', () => {
  it('prefers the explicit value over the env var and leaves unset fields undefined', () => {
    const env = { MY_MODEL: 'from-env', MY_URL: 'https://from-env' };
    const h = hydrateProvider(
      'p',
      { api: 'openai-completions', model: 'explicit', modelEnv: 'MY_MODEL', endpointEnv: 'MY_URL' },
      env,
    );
    expect(h).toMatchObject({
      api: 'openai-completions',
      model: 'explicit',
      endpoint: 'https://from-env',
      apiKey: undefined,
    });
    expect(hydrateProvider('p', { api: 'openai-completions' }, env).model).toBeUndefined();
  });

  it('errors when a named env var is set but empty, instead of falling through silently', () => {
    expect(() => hydrateProvider('p', { api: 'openai-completions', modelEnv: 'MY_MODEL' }, { MY_MODEL: ' ' })).toThrow(
      'MY_MODEL set but empty',
    );
  });

  it('reads the key from apiKeyEnv, or takes the literal apiKey', () => {
    expect(hydrateProvider('p', { api: 'anthropic-messages', apiKeyEnv: 'MY_KEY' }, { MY_KEY: 'k' }).apiKey).toBe('k');
    expect(hydrateProvider('p', { api: 'anthropic-messages', apiKey: 'lit' }, {}).apiKey).toBe('lit');
  });

  it('rejects an unknown api', () => {
    expect(() => hydrateProvider('p', { api: 'gemini' as never }, {})).toThrow('unknown api "gemini"');
  });
});

describe('createModelProvider', () => {
  it('the decisions API defaults to the OpenRouter decisions endpoint', async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      throw new Error('stop');
    }) as unknown as typeof fetch;
    try {
      const judge = createJudge({ semantic: { provider: 'openrouter-jev' } }, {}, undefined, {
        OPENROUTER_API_KEY: 'k',
      });
      await judge
        .evaluate({
          node: {
            id: 'n' as NodeId,
            title: 't',
            type: 'opportunity',
            resolvedType: 'opportunity',
            schemaData: {},
            parentTitles: [],
          },
          rules: [passFailRule],
        })
        .catch(() => {});
      expect(calls[0]).toBe('https://openrouter.ai/api/alpha/decisions');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('creates FakeJudgeProvider for api "fake"', () => {
    expect(createModelProvider('f', { api: 'fake' }, {}) instanceof FakeJudgeProvider).toBe(true);
  });

  it.each([
    ['anthropic-messages', 'ANTHROPIC_API_KEY', AnthropicJudgeProvider],
    ['openai-completions', 'OPENAI_API_KEY', OpenAIJudgeProvider],
    ['openrouter-decisions', 'OPENROUTER_API_KEY', JevJudgeProvider],
    ['typesafe-systemone', 'TYPESAFE_API_KEY', JevJudgeProvider],
  ] as const)('creates %s with its key from the given env (%s)', (api, keyEnv, Class) => {
    expect(createModelProvider('p', { api }, { [keyEnv]: 'k' }) instanceof Class).toBe(true);
  });

  it("does not borrow another provider's key", () => {
    expect(() => createModelProvider('p', { api: 'anthropic-messages' }, { OPENAI_API_KEY: 'o' })).toThrow(
      'ANTHROPIC_API_KEY',
    );
    expect(() => createModelProvider('p', { api: 'openrouter-decisions' }, { ANTHROPIC_API_KEY: 'a' })).toThrow(
      'OPENROUTER_API_KEY',
    );
  });

  it('lets openai run without a key for local endpoints', () => {
    const provider = createModelProvider(
      'local',
      { api: 'openai-completions', endpoint: 'http://localhost:11434/v1' },
      {},
    );
    expect(provider instanceof OpenAIJudgeProvider).toBe(true);
  });
});

describe('createJudge', () => {
  const config = {
    modelProviders: { mine: { api: 'openrouter-decisions' }, claude: { api: 'anthropic-messages' } } as const,
    semantic: { provider: 'claude' },
  };
  const env = { OPENROUTER_API_KEY: 'r', ANTHROPIC_API_KEY: 'a', TYPESAFE_API_KEY: 't' };

  it('uses the top-level judge provider', () => {
    expect(createJudge(config, {}, undefined, env).name).toBe('anthropic');
  });

  it("uses the space's judge over the top-level one, and a run's over both", () => {
    const space = { semantic: { provider: 'mine' } };
    expect(createJudge(config, space, undefined, env).name).toBe('jev');
    expect(createJudge(config, space, 'claude', env).name).toBe('anthropic');
  });

  it('accepts a bundled provider as the judge, with the type defaults', () => {
    expect(createJudge({}, { semantic: { provider: 'openrouter-jev' } }, undefined, env).name).toBe('jev');
    expect(createJudge({ semantic: { provider: 'anthropic' } }, {}, undefined, env).name).toBe('anthropic');
  });

  it('ships the pinned and env variants of each vendor bundle', () => {
    expect(createJudge({}, { semantic: { provider: 'anthropic-haiku-5-5' } }, undefined, env).name).toBe('anthropic');
    expect(createJudge({}, { semantic: { provider: 'anthropic-env' } }, undefined, env).name).toBe('anthropic');
    expect(createJudge({}, { semantic: { provider: 'openai-env' } }, undefined, env).name).toBe('openai');
    expect(createJudge({}, { semantic: { provider: 'typesafe-jev' } }, undefined, env).name).toBe('jev');
  });

  it('lets a configured model provider replace a bundled provider of the same name, keeping type defaults for fields it leaves out', () => {
    const augmented = {
      modelProviders: { anthropic: { api: 'anthropic-messages', model: 'claude-sonnet-5-5' } } as const,
      semantic: { provider: 'anthropic' },
    };
    expect(createJudge(augmented, {}, undefined, env).name).toBe('anthropic');
  });

  it('never infers a provider from API keys in the environment', () => {
    const keys = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'r' };
    expect(() => createJudge({}, {}, undefined, keys)).toThrow(JudgeConfigError);
    expect(() => createJudge({ modelProviders: config.modelProviders }, {}, undefined, keys)).toThrow(
      '--semantic needs a model provider',
    );
  });

  it('rejects a judge that is neither a bundled provider nor a configured one', () => {
    expect(() => createJudge(config, {}, 'nope', env)).toThrow('not configured');
    expect(() => createJudge(config, {}, 'nope', env)).toThrow('Known providers:');
  });

  it('fails when the chosen provider has no key', () => {
    expect(() => createJudge(config, {}, undefined, { OPENROUTER_API_KEY: 'r' })).toThrow('ANTHROPIC_API_KEY');
  });

  it('does not bundle the test-only fake provider', () => {
    expect(() => createJudge({}, { semantic: { provider: 'fake' } }, undefined, env)).toThrow('not configured');
  });
});

describe('judgeForRun (CLI)', () => {
  const config = {
    modelProviders: { f: { api: 'fake' }, g: { api: 'fake' } } as const,
    semantic: { provider: 'f' },
  };

  it('gives no provider unless the run asks with --semantic', () => {
    expect(judgeForRun(config, {})).toBeUndefined();
    expect(judgeForRun({}, {})).toBeUndefined(); // no judge config needed when not asked
    expect(judgeForRun(config, {}, true) instanceof FakeJudgeProvider).toBe(true);
    expect(judgeForRun(config, {}, 'g') instanceof FakeJudgeProvider).toBe(true);
  });

  it('fails when asked and no judge is configured, or the named provider is missing', () => {
    expect(() => judgeForRun({}, {}, true)).toThrow('--semantic needs a model provider');
    expect(() => judgeForRun(config, {}, 'nope')).toThrow('Model provider "nope" is not configured');
  });
});
