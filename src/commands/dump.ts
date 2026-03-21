import { JSON5 } from 'bun';
import { readSpace } from '../read/read-space';

export async function dump(path: string) {
  const { nodes, source, diagnostics } = await readSpace(path);
  console.log(JSON5.stringify({ nodes, source, diagnostics }, null, 2));
}
