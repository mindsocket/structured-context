import { basename, join, resolve } from 'node:path';
import { configPath, loadConfig, resolveSchema } from '../config';

export function listSpaces(): void {
  const path = resolve(configPath());
  const config = loadConfig();
  console.log(`Config: ${path}\n`);
  for (const space of config.spaces) {
    console.log(`${space.name}`);
    console.log(`  path:    ${space.path}`);
    console.log(`  schema:  ${basename(resolveSchema(undefined, config, space))}`);
    const templateDir = space.templateDir ?? config.templateDir;
    if (templateDir) {
      const templateFormat = space.templatePrefix ?? config.templatePrefix ?? '';
      const fullTemplatePath = templateFormat ? join(templateDir, `${templateFormat}*.md`) : templateDir;
      console.log(`  templates: ${fullTemplatePath}`);
    }
    if (space.miroBoardId) console.log(`  miro:    configured`);
    if (space.fieldMap && Object.keys(space.fieldMap).length > 0) {
      const mappings = Object.entries(space.fieldMap)
        .map(([k, v]) => `${k} → ${v}`)
        .join(', ');
      console.log(`  fieldMap: ${mappings}`);
    }
    console.log('');
  }
}
