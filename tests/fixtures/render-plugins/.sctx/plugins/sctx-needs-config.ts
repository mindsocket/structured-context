import type { StructuredContextPlugin } from '../../../../../src/plugins/util';

/** A render plugin whose config requires a field no space declares. */
const needsConfig: StructuredContextPlugin = {
  name: 'sctx-needs-config',
  configSchema: { type: 'object', required: ['token'] },
  render: {
    formats: [{ name: 'out', description: 'Never renders' }],
    render: () => '',
  },
};

export default needsConfig;
