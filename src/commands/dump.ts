import JSON5 from 'json5';
import { readSpace } from '../read/read-space';
import type { SpaceContext } from '../types';

export async function dump(context: SpaceContext) {
  const { nodes, source, diagnostics } = await readSpace(context);
  console.log(JSON5.stringify({ nodes, source, diagnostics }, null, 2));
}
