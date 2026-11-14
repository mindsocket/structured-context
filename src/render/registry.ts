import { discoverPlugins } from '../plugins/loader';
import type { RenderFormat, StructuredContextPlugin } from '../plugins/util';
import { PLUGIN_PREFIX } from '../plugins/util';
import type { SpaceContext } from '../types';

export type ResolvedFormat = {
  qualifiedName: string;
  format: RenderFormat;
  plugin: StructuredContextPlugin;
};

/**
 * Build a registry of all render formats from the given plugins.
 * Formats are namespaced as `{shortPluginName}.{formatName}` where
 * shortPluginName strips the `sctx-` prefix.
 */
export function buildFormatRegistry(plugins: StructuredContextPlugin[]): ResolvedFormat[] {
  const registry: ResolvedFormat[] = [];
  for (const plugin of plugins) {
    if (!plugin.render) continue;
    const shortName = plugin.name.replace(PLUGIN_PREFIX, '');
    for (const format of plugin.render.formats) {
      registry.push({ qualifiedName: `${shortName}.${format.name}`, format, plugin });
    }
  }
  return registry;
}

/** The render formats of every discovered plugin, including those the space declares. */
export async function renderFormats(context?: SpaceContext): Promise<ResolvedFormat[]> {
  const space = context && { pluginMap: context.space?.plugins ?? {}, configDir: context.configDir };
  return buildFormatRegistry(await discoverPlugins(space));
}
