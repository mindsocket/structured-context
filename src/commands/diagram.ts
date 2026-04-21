import { writeFileSync } from 'node:fs';
import { executeRender } from '../render/render';
import type { SpaceContext } from '../types';

export async function diagram(context: SpaceContext, options: { output?: string; filter?: string }): Promise<void> {
  const result = await executeRender('mermaid.graph', context, { filter: options.filter });
  if (options.output) {
    writeFileSync(options.output, result);
    console.log(`Mermaid diagram written to ${options.output}`);
  } else {
    console.log(result);
  }
}
