import { loadPlugins } from '../plugins/loader';
import type { TemplateSyncOptions } from '../plugins/util';
import type { SpaceContext } from '../types';

export async function templateSync(context: SpaceContext, options: TemplateSyncOptions): Promise<void> {
  const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
  const loaded = await loadPlugins(pluginMap, context.configDir);

  for (const { plugin, pluginConfig } of loaded) {
    if (!plugin.templateSync) continue;
    const result = await plugin.templateSync({ ...context, pluginConfig }, options);
    if (result !== null) return;
  }

  throw new Error('No plugin supports template-sync for this space');
}
