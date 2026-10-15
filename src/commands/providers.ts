import { loadConfig } from '../config';
import { BUNDLED_PROVIDERS, hydrateProvider } from '../judge/factory';
import type { ModelProviderConfig } from '../judge/types';

interface ProviderRow {
  name: string;
  source: 'bundled' | 'config';
  api: string;
  model: string | undefined;
  endpoint: string | undefined;
  keyEnv: string | undefined;
  /** Whether the provider would resolve with a key right now. */
  valid: boolean;
  error?: string;
}

function row(name: string, def: ModelProviderConfig, source: 'bundled' | 'config'): ProviderRow {
  try {
    const h = hydrateProvider(name, def);
    const needsKey = h.api !== 'openai-completions' && h.api !== 'fake';
    return {
      name,
      source,
      api: h.api,
      model: h.model,
      endpoint: h.endpoint,
      keyEnv: h.keyEnv,
      valid: !needsKey || h.apiKey !== undefined,
      error: needsKey && h.apiKey === undefined ? `no API key; set ${h.keyEnv}` : undefined,
    };
  } catch (err) {
    return {
      name,
      source,
      api: def.api,
      model: def.model,
      endpoint: def.endpoint,
      keyEnv: def.apiKeyEnv,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** List bundled and configured model providers with their effective config; keys are never shown. */
export function listProviders(options: { json?: boolean } = {}): void {
  const config = loadConfig();
  const configured = config.modelProviders ?? {};
  const rows: ProviderRow[] = [
    ...Object.entries(configured).map(([name, def]) => row(name, def, 'config')),
    ...Object.entries(BUNDLED_PROVIDERS)
      .filter(([name]) => !(name in configured))
      .map(([name, def]) => row(name, def, 'bundled')),
  ];
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    const origin = r.source === 'bundled' ? '' : ' (config)';
    const model = r.model ?? '(api default)';
    const endpoint = r.endpoint ?? '(api default)';
    const key = r.valid ? `key via ${r.keyEnv}` : (r.error ?? 'no key');
    console.log(`${r.name}${origin}\n  api=${r.api}\n  endpoint=${endpoint}\n  model=${model}\n  ${key}`);
  }
}
