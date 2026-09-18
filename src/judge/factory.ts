import { AnthropicJudgeProvider } from './anthropic';
import { FakeJudgeProvider } from './fake';
import { JevJudgeProvider } from './jev';
import { OpenAIJudgeProvider } from './openai';
import type { JudgeConfig, SemanticJudgeProvider } from './types';

/**
 * Instantiate a semantic judge provider based on configuration and environment variables.
 *
 * Precedence:
 * 1. Explicitly passed customProvider (if provided)
 * 2. config.provider or SCTX_JUDGE_PROVIDER === 'fake' -> FakeJudgeProvider
 * 3. config.provider === 'jev' -> JevJudgeProvider (OPENROUTER_API_KEY; always explicit, never auto-detected)
 * 4. config.provider === 'anthropic' or ANTHROPIC_API_KEY present -> AnthropicJudgeProvider
 * 5. config.provider === 'openai' or OPENAI_API_KEY/OPENAI_BASE_URL present -> OpenAIJudgeProvider
 *
 * Throws a clear, actionable error if no provider can be resolved.
 */
export function createJudgeProvider(
  config?: JudgeConfig,
  env: Record<string, string | undefined> = process.env,
  customProvider?: SemanticJudgeProvider,
): SemanticJudgeProvider {
  if (customProvider) {
    return customProvider;
  }

  const requestedProvider = config?.provider || env.SCTX_JUDGE_PROVIDER;
  const apiKey = config?.apiKey || env.SCTX_JUDGE_API_KEY;
  const endpoint = config?.endpoint || env.SCTX_JUDGE_ENDPOINT;
  const model = config?.model || env.SCTX_JUDGE_MODEL;

  if (requestedProvider === 'fake') {
    return new FakeJudgeProvider();
  }

  if (requestedProvider === 'jev') {
    const key = apiKey || env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error(
        'Jev judge provider selected, but no API key was found. Set OPENROUTER_API_KEY in the environment or configure apiKey in config.json.',
      );
    }
    return new JevJudgeProvider({ apiKey: key, model, endpoint });
  }

  // Anthropic resolution
  const hasAnthropicKey = Boolean(apiKey || env.ANTHROPIC_API_KEY);
  if (requestedProvider === 'anthropic' || (!requestedProvider && hasAnthropicKey)) {
    const resolvedKey = apiKey || env.ANTHROPIC_API_KEY;
    if (!resolvedKey) {
      throw new Error(
        'Anthropic judge provider selected, but no API key was found. Set ANTHROPIC_API_KEY in the environment or configure apiKey in config.json.',
      );
    }
    return new AnthropicJudgeProvider({ apiKey: resolvedKey, model, endpoint });
  }

  // OpenAI resolution
  const hasOpenAiKey = Boolean(apiKey || env.OPENAI_API_KEY);
  const hasOpenAiBaseUrl = Boolean(endpoint || env.OPENAI_BASE_URL || env.OPENAI_ENDPOINT);
  if (requestedProvider === 'openai' || (!requestedProvider && (hasOpenAiKey || hasOpenAiBaseUrl))) {
    const resolvedKey = apiKey || env.OPENAI_API_KEY;
    return new OpenAIJudgeProvider({ apiKey: resolvedKey, model, endpoint });
  }

  throw new Error(
    'No semantic judge provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment, or configure "judge" in config.json.',
  );
}
