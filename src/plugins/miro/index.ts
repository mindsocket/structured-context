import { PLUGIN_PREFIX, type StructuredContextPlugin } from '../../api';
import { miroSync } from './sync';

export const miroPlugin: StructuredContextPlugin = {
  name: `${PLUGIN_PREFIX}miro`,
  configSchema: {
    type: 'object',
    properties: {
      boardId: { type: 'string' },
      frameId: { type: 'string' },
    },
    additionalProperties: false,
  },
  render: {
    formats: [{ name: 'board', description: 'Sync space to Miro board' }],
    async render(context, graph, { format, data }) {
      if (format === 'board') {
        const options = {
          newFrame: data?.newFrame as string | undefined,
          dryRun: data?.dryRun as boolean | undefined,
          verbose: data?.verbose as boolean | undefined,
        };
        return await miroSync(context, graph, options);
      }
      throw new Error(`Unknown miro render format: "${format}"`);
    },
  },
};
