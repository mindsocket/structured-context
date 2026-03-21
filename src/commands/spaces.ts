import { basename, join, resolve } from 'node:path';
import { configPath, loadConfig, resolveSchema } from '../config';
import type { MarkdownPluginConfig } from '../plugins/markdown';

export function listSpaces(): void {
  const path = resolve(configPath());
  const config = loadConfig();
  console.log(`Config: ${path}\n`);
  for (const space of config.spaces) {
    const mdCfg = (space.plugins?.['ost-tools-markdown'] ?? {}) as MarkdownPluginConfig;
    console.log(`${space.name}`);
    console.log(`  path:    ${space.path}`);
    console.log(`  schema:  ${basename(resolveSchema(undefined, config, space))}`);
    if (mdCfg.templateDir) {
      const templatePrefix = mdCfg.templatePrefix ?? '';
      const fullTemplatePath = templatePrefix ? join(mdCfg.templateDir, `${templatePrefix}*.md`) : mdCfg.templateDir;
      console.log(`  templates: ${fullTemplatePath}`);
    }
    if (space.miroBoardId) console.log(`  miro:    configured`);
    if (mdCfg.fieldMap && Object.keys(mdCfg.fieldMap).length > 0) {
      const mappings = Object.entries(mdCfg.fieldMap)
        .map(([k, v]) => `${k} → ${v}`)
        .join(', ');
      console.log(`  fieldMap: ${mappings}`);
    }
    const spacePlugins = Object.keys(space.plugins ?? {});
    if (spacePlugins.length > 0) {
      console.log(`  plugins (configured): ${spacePlugins.join(', ')}`);
    }
    console.log('');
  }
}
