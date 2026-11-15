import { BUILTIN_PLUGIN_NAMES } from '../builtin-names';
import type { StructuredContextPlugin } from '../util';

/** Loads the `sctx-map-views` package only to render: it bundles the map view library, which would slow every command's start. */
export const mapViewsPlugin: StructuredContextPlugin = {
  name: BUILTIN_PLUGIN_NAMES.mapViews,
  configSchema: { type: 'object', additionalProperties: false },
  render: {
    formats: [{ name: 'html', description: 'Self-contained interactive HTML page of the space and its map views' }],
    async render(context, graph, options) {
      const { default: plugin } = (await import('sctx-map-views')) as { default: StructuredContextPlugin };
      return plugin.render!.render(context, graph, options);
    },
  },
};
