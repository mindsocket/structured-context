import type { StructuredContextPlugin } from '../../../../../src/plugins/util';

/** Renders what the render callbacks return, for tests. */
const probe: StructuredContextPlugin = {
  name: 'sctx-probe',
  configSchema: { type: 'object' },
  render: {
    formats: [{ name: 'callbacks', description: 'Callback results as JSON' }],
    async render(context) {
      const issues = (await context.callbacks?.validate?.()) ?? [];
      const graph = context.callbacks?.exportGraph?.();
      return JSON.stringify({
        issues: issues.map(({ severity, nodeId }) => ({ severity, nodeId })),
        nodes: graph?.nodes.map((n) => n.title).sort(),
      });
    },
  },
};

export default probe;
