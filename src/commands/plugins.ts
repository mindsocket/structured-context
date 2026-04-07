import { builtinPlugins } from '../plugins';
import { discoverPlugins } from '../plugins/loader';
import type { StructuredContextPlugin } from '../plugins/util';

function showConfigSchema(plugin: StructuredContextPlugin): void {
  console.log(JSON.stringify(plugin.configSchema, null, 2));
}

export async function listPlugins(): Promise<void> {
  const builtinNames = new Set(builtinPlugins.map((p) => p.name));
  const plugins = await discoverPlugins();

  const builtins = plugins.filter((p) => builtinNames.has(p.name));
  const external = plugins.filter((p) => !builtinNames.has(p.name));

  console.log('Built-in plugins:');
  for (const plugin of builtins) {
    console.log(`  ${plugin.name}`);
    showConfigSchema(plugin);
  }

  if (external.length > 0) {
    console.log('\nConfig-adjacent plugins:');
    for (const plugin of external) {
      console.log(`  ${plugin.name}`);
      showConfigSchema(plugin);
    }
  }
}
