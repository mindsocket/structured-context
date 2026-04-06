import type { OstToolsPlugin, ParseResult } from '../../../src/plugins/util';

/** A plugin that returns a fixed set of nodes (for testing first-match-wins). */
const customPlugin: OstToolsPlugin = {
  name: 'ost-tools-custom-plugin',
  configSchema: { type: 'object' },
  async parse(): Promise<ParseResult> {
    return {
      nodes: [],
      parseIgnored: [],
      diagnostics: { source: 'custom' },
    };
  },
};

export default customPlugin;
