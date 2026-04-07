import type { StructuredContextPlugin } from '../../../src/plugins/util';

/** A plugin that always returns null (never handles any space). */
const nullPlugin: StructuredContextPlugin = {
  name: 'sctx-null-plugin',
  configSchema: { type: 'object' },
  async parse() {
    return null;
  },
};

export default nullPlugin;
