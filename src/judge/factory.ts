import type { Rule } from '../types';
import { AnthropicJudgeProvider } from './provider/anthropic';
import { FakeJudgeProvider } from './provider/fake';
import { JevJudgeProvider } from './provider/jev';
import { OpenAIJudgeProvider } from './provider/openai';
import type {
  JudgeConfig,
  JudgeProviderDefinition,
  SemanticJudgeInput,
  SemanticJudgeProvider,
  SemanticJudgeResult,
} from './types';

type Env = Record<string, string | undefined>;

/** Environment variable each provider type reads its API key from unless `apiKeyEnv` says otherwise. */
const DEFAULT_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  jev: 'OPENROUTER_API_KEY',
} as const;

const PROVIDER_TYPES = ['anthropic', 'openai', 'jev', 'fake'] as const;

/** Name of the provider defined by the flat `judge: { provider, ... }` shorthand. */
export const DEFAULT_JUDGE_NAME = 'default';

/** The judge is misconfigured (no provider, unknown provider, missing key). Reported as a plain CLI error. */
export class JudgeConfigError extends Error {}

/** Every provider the config defines, by name, and the one used for rules that don't name any. */
function providerDefinitions(
  config: JudgeConfig | undefined,
  env: Env,
): { definitions: Record<string, JudgeProviderDefinition>; defaultName?: string } {
  const definitions: Record<string, JudgeProviderDefinition> = { ...config?.providers };

  // The flat shorthand (and SCTX_JUDGE_* overrides) define one provider named "default".
  const type = config?.provider || env.SCTX_JUDGE_PROVIDER;
  if (type) {
    definitions[DEFAULT_JUDGE_NAME] = {
      type,
      model: config?.model || env.SCTX_JUDGE_MODEL,
      endpoint: config?.endpoint || env.SCTX_JUDGE_ENDPOINT,
      apiKey: config?.apiKey || env.SCTX_JUDGE_API_KEY,
      apiKeyEnv: config?.apiKeyEnv,
    };
  }

  const names = Object.keys(definitions);
  const defaultName =
    config?.use ?? (DEFAULT_JUDGE_NAME in definitions ? DEFAULT_JUDGE_NAME : names.length === 1 ? names[0] : undefined);
  return { definitions, defaultName };
}

/**
 * Instantiate one provider from its definition. The type is always explicit and is never inferred from API keys
 * in the environment, so a key set for another tool is never spent on judging. Once the type is chosen, its key
 * comes from `apiKey`, else the environment variable named by `apiKeyEnv` (default: the type's usual variable).
 */
function createProvider(name: string, def: JudgeProviderDefinition, env: Env): SemanticJudgeProvider {
  const type = def.type;
  if (!type || type === 'none') {
    throw new JudgeConfigError(
      `Judge "${name}" has no provider type. Set it to one of: ${PROVIDER_TYPES.join(', ')} (config.example.json shows a template).`,
    );
  }
  if (!(PROVIDER_TYPES as readonly string[]).includes(type)) {
    throw new JudgeConfigError(
      `Unknown judge provider "${type}" for "${name}". Use one of: ${PROVIDER_TYPES.join(', ')}.`,
    );
  }
  if (type === 'fake') return new FakeJudgeProvider();

  const keyEnv = def.apiKeyEnv ?? DEFAULT_KEY_ENV[type as keyof typeof DEFAULT_KEY_ENV];
  const apiKey = def.apiKey || env[keyEnv];
  const { model, endpoint } = def;

  // OpenAI-compatible endpoints (Ollama, vLLM, ...) may need no key.
  if (!apiKey && type !== 'openai') {
    throw new JudgeConfigError(
      `Judge "${name}" (${type}) has no API key. Set ${keyEnv} in the environment, or "apiKey" / "apiKeyEnv" on the provider.`,
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
 * Routes each semantic rule to the judge provider it names (`judge` on the rule), else the configured default.
 * A run-level override replaces every rule's choice. Providers are created on first use, so one that no rule
 * reaches needs no credentials.
 */
export class RoutedJudgeProvider implements SemanticJudgeProvider {
  readonly name = 'routed';
  private readonly cache = new Map<string, SemanticJudgeProvider>();

  constructor(
    private readonly definitions: Record<string, JudgeProviderDefinition>,
    private readonly defaultName: string | undefined,
    private readonly env: Env,
    private readonly override?: string,
    private readonly injected?: SemanticJudgeProvider,
  ) {}

  /** The provider that judges a rule asking for `requested` (undefined: the default). */
  resolve(requested?: string): SemanticJudgeProvider {
    if (this.injected) return this.injected;
    const name = this.override ?? requested ?? this.defaultName;
    if (!name) {
      const known = Object.keys(this.definitions);
      throw new JudgeConfigError(
        known.length === 0
          ? `No semantic judge configured. Set "judge.provider" in config.json (one of: ${PROVIDER_TYPES.join(', ')}) or SCTX_JUDGE_PROVIDER.`
          : `Several judge providers are configured (${known.join(', ')}). Set "judge.use" for the default, or name one on the rule ("judge") or with --judge.`,
      );
    }
    const def = this.definitions[name];
    if (!def) {
      const known = Object.keys(this.definitions);
      throw new JudgeConfigError(
        `Judge "${name}" is not configured.${known.length ? ` Configured: ${known.join(', ')}.` : ' Add it under "judge.providers" in config.json.'}`,
      );
    }
    let provider = this.cache.get(name);
    if (!provider) {
      provider = createProvider(name, def, this.env);
      this.cache.set(name, provider);
    }
    return provider;
  }

  /** Fail now, before any request is made, if a rule's judge is not usable. */
  prepare(rules: Rule[]): void {
    for (const rule of rules) {
      if (rule.mode === 'semantic') this.resolve(rule.judge);
    }
  }

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    const groups = new Map<SemanticJudgeProvider, SemanticJudgeInput['rules']>();
    for (const rule of input.rules) {
      const provider = this.resolve(rule.judge);
      groups.set(provider, [...(groups.get(provider) ?? []), rule]);
    }
    const results: Record<string, SemanticJudgeResult> = {};
    for (const [provider, rules] of groups) {
      Object.assign(results, await provider.evaluate({ node: input.node, rules }));
    }
    return results;
  }
}

/**
 * Build the judge for a run from config and environment. `override` (the `--judge` flag) names the provider to use
 * for every rule; `customProvider` (tests, injection) replaces configured providers altogether.
 */
export function createJudge(
  config?: JudgeConfig,
  env: Env = process.env,
  customProvider?: SemanticJudgeProvider,
  override?: string,
): RoutedJudgeProvider {
  const { definitions, defaultName } = providerDefinitions(config, env);
  return new RoutedJudgeProvider(definitions, defaultName, env, override, customProvider);
}

/** The single provider for a config: the default one, or the one named by `name`. */
export function createJudgeProvider(
  config?: JudgeConfig,
  env: Env = process.env,
  customProvider?: SemanticJudgeProvider,
  name?: string,
): SemanticJudgeProvider {
  return createJudge(config, env, customProvider).resolve(name);
}
