import { AnthropicJudgeProvider } from './provider/anthropic';
import { FakeJudgeProvider } from './provider/fake';
import { JevJudgeProvider } from './provider/jev';
import { OpenAIJudgeProvider } from './provider/openai';
import type { JudgeConfig, SemanticJudgeProvider } from './types';

/** Environment variable each provider reads its API key from when none is configured. */
const PROVIDER_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  jev: 'OPENROUTER_API_KEY',
} as const;

/** The judge is misconfigured (no provider, unknown provider, missing key). Reported as a plain CLI error. */
export class JudgeConfigError extends Error {}

const PROVIDERS = ['anthropic', 'openai', 'jev', 'fake'] as const;

/**
 * Instantiate a semantic judge provider.
 *
 * The provider is always explicit: `judge.provider` in config or `SCTX_JUDGE_PROVIDER`. It is never
 * inferred from whichever API keys happen to be in the environment, so a key set for another tool is
 * never spent on judging unless the user chose that provider.
 *
 * Once a provider is chosen, its API key comes from `judge.apiKey`, `SCTX_JUDGE_API_KEY`, or the
 * provider's usual variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`).
 * An explicitly passed `customProvider` wins over everything.
 */
export function createJudgeProvider(
  config?: JudgeConfig,
  env: Record<string, string | undefined> = process.env,
  customProvider?: SemanticJudgeProvider,
): SemanticJudgeProvider {
  if (customProvider) return customProvider;

  const provider = config?.provider || env.SCTX_JUDGE_PROVIDER;
  if (!provider) {
    throw new JudgeConfigError(
      `No semantic judge provider configured. Set "judge.provider" in config.json (one of: ${PROVIDERS.join(', ')}) or SCTX_JUDGE_PROVIDER.`,
    );
  }
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new JudgeConfigError(`Unknown semantic judge provider "${provider}". Use one of: ${PROVIDERS.join(', ')}.`);
  }

  const model = config?.model || env.SCTX_JUDGE_MODEL;
  const endpoint = config?.endpoint || env.SCTX_JUDGE_ENDPOINT;
  if (provider === 'fake') return new FakeJudgeProvider();

  const keyEnv = PROVIDER_KEY_ENV[provider as keyof typeof PROVIDER_KEY_ENV];
  const apiKey = config?.apiKey || env.SCTX_JUDGE_API_KEY || env[keyEnv];

  // OpenAI-compatible endpoints (Ollama, vLLM, ...) may need no key.
  if (!apiKey && provider !== 'openai') {
    throw new JudgeConfigError(
      `Judge provider "${provider}" selected, but no API key was found. Set ${keyEnv} in the environment or "judge.apiKey" in config.json.`,
    );
  }

  switch (provider) {
    case 'anthropic':
      return new AnthropicJudgeProvider({ apiKey: apiKey as string, model, endpoint });
    case 'jev':
      return new JevJudgeProvider({ apiKey: apiKey as string, model, endpoint });
    default:
      return new OpenAIJudgeProvider({ apiKey, model, endpoint });
  }
}
