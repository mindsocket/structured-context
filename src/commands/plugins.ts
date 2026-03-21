import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { configPath } from '../config';
import { builtinPlugins } from '../plugins';
import { CONFIG_PLUGINS_DIR, PLUGIN_PREFIX } from '../plugins/util';

export function listPlugins(): void {
  console.log('Built-in plugins:');
  for (const plugin of builtinPlugins) {
    console.log(`  ${plugin.name}`);
  }

  const cfgDir = dirname(resolve(configPath()));
  const pluginsDir = join(cfgDir, CONFIG_PLUGINS_DIR);
  if (existsSync(pluginsDir)) {
    const entries = readdirSync(pluginsDir).filter((e) => e.startsWith(PLUGIN_PREFIX));
    if (entries.length > 0) {
      console.log('\nConfig-adjacent plugins:');
      for (const entry of entries) {
        console.log(`  ${entry}`);
      }
    }
  }
}
