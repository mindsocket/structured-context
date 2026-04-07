import type { LoadedPlugin } from '../plugins/loader';
import type { RenderFormat } from '../plugins/util';
import { PLUGIN_PREFIX } from '../plugins/util';

export type ResolvedFormat = {
  qualifiedName: string;
  format: RenderFormat;
  plugin: LoadedPlugin;
};

/**
 * Build a registry of all render formats from loaded plugins.
 * Formats are namespaced as `{shortPluginName}.{formatName}` where
 * shortPluginName strips the `sctx-` prefix.
 */
export function buildFormatRegistry(loaded: LoadedPlugin[]): ResolvedFormat[] {
  const registry: ResolvedFormat[] = [];
  for (const lp of loaded) {
    if (!lp.plugin.render) continue;
    const shortName = lp.plugin.name.replace(PLUGIN_PREFIX, '');
    for (const format of lp.plugin.render.formats) {
      registry.push({
        qualifiedName: `${shortName}.${format.name}`,
        format,
        plugin: lp,
      });
    }
  }
  return registry;
}
