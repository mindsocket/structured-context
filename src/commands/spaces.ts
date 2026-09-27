import { basename, resolve } from 'node:path';
import { configPath, getConfigSourceFiles, loadConfig } from '../config';

function renderConfigValue(v: unknown): string {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

export function listSpaces(options: { json?: boolean } = {}): void {
  const path = resolve(configPath());
  const config = loadConfig();
  if (options.json) {
    const spaces = config.spaces.map((space) => ({
      name: space.name,
      path: space.path,
      schema: space.schema ?? config.schema,
    }));
    console.log(JSON.stringify({ configFiles: [...getConfigSourceFiles()], spaces }));
    return;
  }
  console.log(`Config: ${path}\n`);
  for (const space of config.spaces) {
    console.log(`${space.name}`);
    console.log(`  path:    ${space.path}`);
    const schema = space.schema ?? config.schema;
    console.log(`  schema:  ${schema ? basename(schema) : '(none)'}`);
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
