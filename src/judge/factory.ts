import type { AnthropicJudgeProviderOptions } from './provider/anthropic';
import { AnthropicJudgeProvider } from './provider/anthropic';
import { FakeJudgeProvider } from './provider/fake';
import type { JevJudgeProviderOptions } from './provider/jev';
import { JevJudgeProvider } from './provider/jev';
import { OpenAIJudgeProvider } from './provider/openai';
import {
  type HydratedProvider,
  MODEL_PROVIDER_APIS,
  type ModelProviderConfig,
  type SemanticJudgeProvider,
} from './types';

type Env = Record<string, string | undefined>;

/**
 * Bundled providers: usable as a judge by name, without a `modelProviders` entry. A user entry of the
 * same name replaces one wholesale; fields it leaves out take the type defaults in the constructors.
 * Every value here is explicit: no bundle reads the environment.
 */
export const BUNDLED_PROVIDERS: Record<string, ModelProviderConfig> = {
  // Jev decision model. The TypeSafe and OpenRouter decision endpoints share a wire shape, so both
  // speak a decisions API; the vendors' endpoints stay distinct bundles.
  'typesafe-jev': { api: 'typesafe-systemone', model: 'jev-latest', apiKeyEnv: 'TYPESAFE_API_KEY' },
  'openrouter-jev': { api: 'openrouter-decisions', model: 'typesafe/jev-latest', apiKeyEnv: 'OPENROUTER_API_KEY' },
  // Chat models. `<vendor>` is a fixed opinionated bundle; `<vendor>-env` hydrates model and endpoint
  // from the vendor's usual environment variables, falling back to the bundle's defaults.
  anthropic: { api: 'anthropic-messages', model: 'claude-haiku-5-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  'anthropic-haiku-5-5': { api: 'anthropic-messages', model: 'claude-haiku-5-5', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  'anthropic-env': {
    api: 'anthropic-messages',
    model: 'claude-haiku-5-5',
    modelEnv: 'ANTHROPIC_MODEL',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  openai: { api: 'openai-completions', model: 'gpt-4o-mini', apiKeyEnv: 'OPENAI_API_KEY' },
  'openai-env': {
    api: 'openai-completions',
    model: 'gpt-4o-mini',
    modelEnv: 'OPENAI_MODEL',
    endpointEnv: 'OPENAI_BASE_URL',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  openrouter: { api: 'openai-completions', model: 'openai/gpt-4o-mini', apiKeyEnv: 'OPENROUTER_API_KEY' },
} as const;

/** Each API reads its key from this variable unless `apiKeyEnv` names another one. Model and endpoint never read env vars. */
const DEFAULT_KEY_ENV: Record<string, string> = {
  'anthropic-messages': 'ANTHROPIC_API_KEY',
  'openai-completions': 'OPENAI_API_KEY',
  'openrouter-decisions': 'OPENROUTER_API_KEY',
  'typesafe-systemone': 'TYPESAFE_API_KEY',
} as const;

/** The judge is misconfigured (no provider, unknown provider, missing key). Reported as a plain CLI error. */
export class JudgeConfigError extends Error {}

/**
 * Hydrate a provider definition into concrete values, in one place. Per field: the explicit value
 * wins, then the named environment variable if it is set (a set-but-empty variable is an error, not
 * a silent fall-through), then the definition's own default. The key is special: it must resolve.
 */
export function hydrateProvider(name: string, def: ModelProviderConfig, env: Env = process.env): HydratedProvider {
  if (!(MODEL_PROVIDER_APIS as readonly string[]).includes(def.api)) {
    throw new JudgeConfigError(
      `Model provider "${name}" has unknown api "${def.api}". Use one of: ${MODEL_PROVIDER_APIS.join(', ')}.`,
    );
  }
  const fromEnv = (value: string | undefined, envName: string | undefined): string | undefined => {
    if (value !== undefined) return value;
    if (!envName) return undefined;
    const envValue = env[envName];
    if (envValue !== undefined && envValue.trim() === '') {
      throw new JudgeConfigError(
        `Model provider "${name}" has ${envName}=${envName} set but empty; set a value or unset the variable.`,
      );
    }
    return envValue;
  };
  const model = fromEnv(def.model, def.modelEnv);
  const endpoint = fromEnv(def.endpoint, def.endpointEnv);
  const keyEnv = def.apiKeyEnv ?? DEFAULT_KEY_ENV[def.api];
  const apiKey = def.apiKey ?? (keyEnv ? env[keyEnv] : undefined);
  return { api: def.api, model, endpoint, apiKey, keyEnv };
}

/**
 * Instantiate one provider from a definition. The API is always explicit and is never inferred from
 * API keys in the environment, so a key set for another tool is never spent on judging. Constructors
 * apply their own API defaults for fields left undefined after hydration.
 */
export function createModelProvider(
  name: string,
  def: ModelProviderConfig,
  env: Env = process.env,
): SemanticJudgeProvider {
  const h = hydrateProvider(name, def, env);
  // OpenAI-compatible endpoints (Ollama, vLLM, ...) may need no key; the others must resolve one.
  // A key never borrows another provider's variable: only the named apiKeyEnv (or literal apiKey) counts.
  if (!h.apiKey && h.api !== 'openai-completions' && h.api !== 'fake') {
    throw new JudgeConfigError(
      `Model provider "${name}" (${h.api}) has no API key. Set ${h.keyEnv} in the environment, or "apiKey" / "apiKeyEnv" on the provider.`,
    );
  }
  switch (h.api) {
    case 'fake':
      return new FakeJudgeProvider();
    case 'anthropic-messages':
      return new AnthropicJudgeProvider(h as AnthropicJudgeProviderOptions);
    case 'openrouter-decisions':
    case 'typesafe-systemone':
      return new JevJudgeProvider(h as JevJudgeProviderOptions);
    case 'openai-completions':
      return new OpenAIJudgeProvider(h);
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
 * `judge.provider`, else the top-level one. The name resolves against `modelProviders` first, then
 * the bundled providers. Throws {@link JudgeConfigError} when it cannot be built.
 */
export function createJudge(
  config: { modelProviders?: Record<string, ModelProviderConfig>; judge?: { provider?: string } },
  space: { judge?: { provider?: string } } = {},
  name?: string,
  env: Env = process.env,
): SemanticJudgeProvider {
  const chosen = name ?? space.judge?.provider ?? config.judge?.provider;
  if (!chosen) {
    throw new JudgeConfigError(
      'No judge configured. Set "judge.provider" in config.json to a bundled provider (e.g. "openrouter-jev") or to the name of an entry in "modelProviders".',
    );
  }
  const def = config.modelProviders?.[chosen] ?? BUNDLED_PROVIDERS[chosen];
  if (!def) {
    const known = [...Object.keys(BUNDLED_PROVIDERS), ...Object.keys(config.modelProviders ?? {})];

    throw new JudgeConfigError(
      `Model provider "${chosen}" is not configured.${known.length ? ` Known providers: ${known.join(', ')}.` : ''}`,
    );
  }
  return createModelProvider(chosen, def, env);
}
