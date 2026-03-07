import { statSync } from 'node:fs';
import JSON5 from 'json5';
import { readSpaceDirectory } from '../read-space-directory';
import { readSpaceOnAPage } from '../read-space-on-a-page';

export async function dump(path: string) {
  if (statSync(path).isFile()) {
    const { nodes, diagnostics } = readSpaceOnAPage(path);
    console.log(JSON5.stringify({ nodes, diagnostics }, null, 2));
  } else {
    const { nodes, skipped, nonSpace: nonOst } = await readSpaceDirectory(path);
    console.log(JSON5.stringify({ nodes, skipped, nonOst }, null, 2));
  }
}
