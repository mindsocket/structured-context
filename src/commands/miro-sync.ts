import type { SyncOptions } from '../plugins/miro/sync';
import { executeRender } from '../render/render';
import type { SpaceContext } from '../types';

export async function miroSyncCommand(context: SpaceContext, options: SyncOptions): Promise<void> {
  const summary = await executeRender('sctx-miro:board', context, {
    filter: undefined,
    data: options as Record<string, unknown>,
  });
  console.log(summary);
}
