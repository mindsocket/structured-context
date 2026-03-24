import type { SpaceContext } from '../types';
import { executeRender } from '../render/render';

export async function show(context: SpaceContext, options?: { filter?: string }) {
  const result = await executeRender('markdown.bullets', context, { filter: options?.filter });
  process.stdout.write(result);
  if (!result.endsWith('\n')) process.stdout.write('\n');
}
