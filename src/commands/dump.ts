import { JSON5 } from 'bun';
import { readSpace } from '../read/read-space';

export async function dump(path: string) {
  const result = await readSpace(path);
  if (result.kind === 'page') {
    const { nodes, diagnostics } = result;
    console.log(JSON5.stringify({ nodes, diagnostics }, null, 2));
  } else {
    const { nodes, skipped, nonSpace } = result;
    console.log(JSON5.stringify({ nodes, skipped, nonSpace }, null, 2));
  }
}
