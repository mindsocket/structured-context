import type { OstToolsPlugin } from '../../../src/plugins/util';

/** A plugin that always returns null (never handles any space). */
const nullPlugin: OstToolsPlugin = {
  name: 'ost-tools-null-plugin',
  configSchema: { type: 'object' },
  async parse() {
    return null;
  },
};

export default nullPlugin;
