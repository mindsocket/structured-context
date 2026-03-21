import { basename, resolve } from 'node:path';
import { configPath, loadConfig, resolveSchema } from '../config';

function renderConfigValue(v: unknown): string {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

export function listSpaces(): void {
  const path = resolve(configPath());
  const config = loadConfig();
  console.log(`Config: ${path}\n`);
  for (const space of config.spaces) {
    console.log(`${space.name}`);
    console.log(`  path:    ${space.path}`);
    console.log(`  schema:  ${basename(resolveSchema(undefined, config, space))}`);
    if (space.miroBoardId) console.log(`  miro:    configured`);
    const plugins = space.plugins ?? {};
    if (Object.keys(plugins).length > 0) {
      console.log('  plugins:');
      for (const [name, cfg] of Object.entries(plugins)) {
        const entries = Object.entries(cfg);
        if (entries.length === 0) {
          console.log(`    ${name}`);
        } else {
          console.log(`    ${name}:`);
          for (const [k, v] of entries) {
            console.log(`      ${k}: ${renderConfigValue(v)}`);
          }
        }
      }
    }
    console.log('');
  }
}
