import { AnthropicJudgeProvider } from './provider/anthropic';
import { FakeJudgeProvider } from './provider/fake';
import { JevJudgeProvider } from './provider/jev';
import { OpenAIJudgeProvider } from './provider/openai';
import { MODEL_PROVIDER_TYPES, type ModelProviderConfig, type SemanticJudgeProvider } from './types';

type Env = Record<string, string | undefined>;

/** Environment variable each provider type reads its API key from unless `apiKeyEnv` says otherwise. */
const DEFAULT_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  jev: 'OPENROUTER_API_KEY',
} as const;

/** The judge is misconfigured (no provider, unknown provider, missing key). Reported as a plain CLI error. */
export class JudgeConfigError extends Error {}

/**
 * Instantiate one provider from its definition. The type is always explicit and is never inferred from API keys
 * in the environment, so a key set for another tool is never spent on judging. Once the type is chosen, its key
 * comes from `apiKey`, else the environment variable named by `apiKeyEnv` (default: the type's usual variable).
 */
export function createModelProvider(
  name: string,
  def: ModelProviderConfig,
  env: Env = process.env,
): SemanticJudgeProvider {
  const type = def.type;
  if (!(MODEL_PROVIDER_TYPES as readonly string[]).includes(type)) {
    throw new JudgeConfigError(
      `Model provider "${name}" has unknown type "${type}". Use one of: ${MODEL_PROVIDER_TYPES.join(', ')}.`,
    );
  }
  if (type === 'fake') return new FakeJudgeProvider();

  const keyEnv = def.apiKeyEnv ?? DEFAULT_KEY_ENV[type as keyof typeof DEFAULT_KEY_ENV];
  const apiKey = def.apiKey || env[keyEnv];
  const { model, endpoint } = def;

  // OpenAI-compatible endpoints (Ollama, vLLM, ...) may need no key.
  if (!apiKey && type !== 'openai') {
    throw new JudgeConfigError(
      `Model provider "${name}" (${type}) has no API key. Set ${keyEnv} in the environment, or "apiKey" / "apiKeyEnv" on the provider.`,
    );
  }
  switch (type) {
    case 'anthropic':
      return new AnthropicJudgeProvider({ apiKey: apiKey as string, model, endpoint });
    case 'jev':
      return new JevJudgeProvider({ apiKey: apiKey as string, model, endpoint });
    default:
      return new OpenAIJudgeProvider({ apiKey, model, endpoint });
  }
}

/**
 * The judge a CLI run asks for: none without `--semantic` or `--judge <provider>`; the named provider with
 * `--judge`; else the configured one.
 */
export function judgeForRun(
  config: Parameters<typeof createJudge>[0],
  space: Parameters<typeof createJudge>[1],
  options: { semantic?: boolean; judge?: string },
): SemanticJudgeProvider | undefined {
  if (!options.semantic && options.judge === undefined) return undefined;
  return createJudge(config, space, options.judge);
}

/**
 * The judge for a run: the model provider named by `name` (the `--judge` override), else the space's
 * `judge.provider`, else the top-level one. Throws {@link JudgeConfigError} when it cannot be built.
 */
export function createJudge(
  config: { modelProviders?: Record<string, ModelProviderConfig>; judge?: { provider?: string } },
  space: { judge?: { provider?: string } } = {},
  name?: string,
  env: Env = process.env,
): SemanticJudgeProvider {
  const chosen = name ?? space.judge?.provider ?? config.judge?.provider;
  const known = Object.keys(config.modelProviders ?? {});
  if (!chosen) {
    throw new JudgeConfigError(
      'No judge configured. Set "judge.provider" in config.json to the name of an entry in "modelProviders".',
    );
  }
  const def = config.modelProviders?.[chosen];
  if (!def) {
    throw new JudgeConfigError(
      `Model provider "${chosen}" is not configured.${known.length ? ` Configured: ${known.join(', ')}.` : ' Add it under "modelProviders" in config.json.'}`,
    );
  }
  return createModelProvider(chosen, def, env);
}
