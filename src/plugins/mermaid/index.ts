import type { StructuredContextPlugin } from '../util';
import { PLUGIN_PREFIX } from '../util';
import { renderMermaid } from './render-mermaid';

export const mermaidPlugin: StructuredContextPlugin = {
  name: `${PLUGIN_PREFIX}mermaid`,
  configSchema: { type: 'object', additionalProperties: false },
  render: {
    formats: [{ name: 'graph', description: 'Mermaid graph TD diagram' }],
    render(_context, graph, { format }) {
      if (format === 'graph') return renderMermaid(graph);
      throw new Error(`Unknown mermaid render format: "${format}"`);
    },
  },
};
