import { executeRender } from '../render/render';
import type { SpaceContext } from '../types';

export async function show(context: SpaceContext, options?: { filter?: string; hierarchy?: string }) {
  const result = await executeRender('markdown.bullets', context, {
    filter: options?.filter,
    hierarchy: options?.hierarchy,
  });
  process.stdout.write(result);
  if (!result.endsWith('\n')) process.stdout.write('\n');
}
