import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';

const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    spaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          alias: { type: 'string', pattern: '^[a-z0-9_-]+$' },
          path: { type: 'string' },
        },
        required: ['alias', 'path'],
        additionalProperties: false,
      },
    },
  },
  required: ['spaces'],
  additionalProperties: false,
};

export interface SpaceConfig {
  alias: string;
  path: string;
}

export interface Config {
  spaces: SpaceConfig[];
}

export function loadConfig(): Config {
  const configPath = join(import.meta.dir, '..', 'config.json');
  if (!existsSync(configPath)) {
    return { spaces: [] };
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const ajv = new Ajv();
  const validate = ajv.compile(CONFIG_SCHEMA);

  if (!validate(config)) {
    console.error('Invalid config.json:', validate.errors);
    process.exit(1);
  }

  return config as unknown as Config;
}

export function resolveSpace(aliasOrPath: string, config: Config): string {
  const space = config.spaces.find(s => s.alias === aliasOrPath);
  return space ? space.path : aliasOrPath;
}
