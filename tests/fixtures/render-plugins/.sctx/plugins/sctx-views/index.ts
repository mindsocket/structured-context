import type { StructuredContextPlugin } from '../../../../../../src/plugins/util';

/** A plugin that only ships resources (a map-views folder). */
const views: StructuredContextPlugin = { name: 'sctx-views', configSchema: { type: 'object' } };

export default views;
