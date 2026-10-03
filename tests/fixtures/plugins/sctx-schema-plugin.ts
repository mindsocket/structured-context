import { resolve } from 'node:path';
import type { StructuredContextPlugin } from '../../../src/plugins/util';

const schemaPlugin: StructuredContextPlugin = {
  name: 'sctx-schema-plugin',
  configSchema: { type: 'object' },
  schemasDir: resolve(import.meta.dir, 'schemas'),
};

export default schemaPlugin;
