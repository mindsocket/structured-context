import { BUILTIN_PLUGIN_NAMES } from '../builtin-names';
import type { StructuredContextPlugin } from '../util';
import { renderMermaid } from './render-mermaid';

export const mermaidPlugin: StructuredContextPlugin = {
  name: BUILTIN_PLUGIN_NAMES.mermaid,
  configSchema: { type: 'object', additionalProperties: false },
  render: {
    formats: [{ name: 'graph', description: 'Mermaid graph TD diagram' }],
    render(_context, graph, { format }) {
      if (format === 'graph') return renderMermaid(graph);
      throw new Error(`Unknown mermaid render format: "${format}"`);
    },
  },
};
