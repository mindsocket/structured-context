import { dirname } from 'node:path';
import { configPath } from '../config';
import { loadPlugins } from '../plugins/loader';
import type { ReadSpaceResult } from '../types';
import { loadSpaceContext } from './context';

export async function readSpace(path: string, options?: { schemaPath?: string }): Promise<ReadSpaceResult> {
  const context = loadSpaceContext(path, options?.schemaPath);

  const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
  const cfgDir = dirname(configPath());
  const loaded = await loadPlugins(pluginMap, cfgDir);

  for (const { plugin, pluginConfig } of loaded) {
    if (!plugin.parse) continue;
    const result = await plugin.parse({ ...context, pluginConfig });
    if (result !== null) {
      return { nodes: result.nodes, source: plugin.name, diagnostics: result.diagnostics };
    }
  }

  throw new Error(`No plugin handled space at: ${path}`);
}
