import { writeFileSync } from 'node:fs';
import type { SpaceContext } from '../types';
import { executeRender } from '../render/render';

export async function diagram(context: SpaceContext, options: { output?: string; filter?: string }): Promise<void> {
  const result = await executeRender('markdown.mermaid', context, { filter: options.filter });
  if (options.output) {
    writeFileSync(options.output, result);
    console.log(`Mermaid diagram written to ${options.output}`);
  } else {
    console.log(result);
  }
}
