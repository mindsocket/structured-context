import { writeFileSync } from 'node:fs';
import { loadPlugins } from '../plugins/loader';
import { discoverPlugins } from '../plugins/loader';
import type { SpaceContext } from '../types';
import { buildFormatRegistry } from '../render/registry';
import { executeRender } from '../render/render';

export async function render(
  context: SpaceContext,
  format: string,
  options: { filter?: string; output?: string },
): Promise<void> {
  const result = await executeRender(format, context, { filter: options.filter });
  if (options.output) {
    writeFileSync(options.output, result);
    console.error(`Written to ${options.output}`);
  } else {
    process.stdout.write(result);
    if (!result.endsWith('\n')) process.stdout.write('\n');
  }
}

export async function renderList(context?: SpaceContext): Promise<void> {
  let loaded;
  if (context) {
    const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
    loaded = await loadPlugins(pluginMap, context.configDir);
  } else {
    const discovered = await discoverPlugins();
    loaded = discovered.map((plugin) => ({ plugin, pluginConfig: {} }));
  }

  const registry = buildFormatRegistry(loaded);

  if (registry.length === 0) {
    console.log('No render formats available.');
    return;
  }

  for (const entry of registry) {
    console.log(`  ${entry.qualifiedName.padEnd(24)} ${entry.format.description}`);
  }
}
