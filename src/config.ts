import { readFileSync, writeFileSync, existsSync } from 'fs';
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
          miroBoardId: { type: 'string' },
          miroFrameId: { type: 'string' },
        },
        required: ['alias', 'path'],
        additionalProperties: false,
      },
    },
    schema: { type: 'string' },
    templateDir: { type: 'string' },
  },
  required: ['spaces'],
  additionalProperties: false,
};

export interface SpaceConfig {
  alias: string;
  path: string;
  miroBoardId?: string;
  miroFrameId?: string;
}

export interface Config {
  spaces: SpaceConfig[];
  schema?: string;
  templateDir?: string;
}

function configPath(): string {
  return join(import.meta.dir, '..', 'config.json');
}

export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) {
    return { spaces: [] };
  }

  const config = JSON.parse(readFileSync(path, 'utf-8'));
  const ajv = new Ajv();
  const validate = ajv.compile(CONFIG_SCHEMA);

  if (!validate(config)) {
    console.error('Invalid config.json:', validate.errors);
    process.exit(1);
  }

  return config as unknown as Config;
}

/** Resolve alias-or-path to a filesystem path. Falls through if not an alias. */
export function resolveSpacePath(aliasOrPath: string, config: Config): string {
  const space = config.spaces.find(s => s.alias === aliasOrPath);
  return space ? space.path : aliasOrPath;
}

/** Get the full space config entry by alias. Throws if not found. */
export function getSpaceConfig(alias: string, config: Config): SpaceConfig {
  const space = config.spaces.find(s => s.alias === alias);
  if (!space) {
    throw new Error(`Unknown space config: "${alias}". Check config.json.`);
  }
  return space;
}

/** Resolve schema path: CLI arg > config entry > hardcoded default. */
export function resolveSchema(cliArg: string | undefined, config: Config): string {
  return cliArg ?? config.schema ?? 'schema.json';
}

/** Resolve template dir: CLI arg > config entry > error. */
export function resolveTemplateDir(cliArg: string | undefined, config: Config): string {
  const dir = cliArg ?? config.templateDir;
  if (!dir) {
    console.error('Error: template-dir is required (specify as argument or set templateDir in config.json)');
    process.exit(1);
  }
  return dir;
}

/** Update a field on a space entry and persist config.json. */
export function updateSpaceField(alias: string, field: keyof SpaceConfig, value: string): void {
  const config = loadConfig();
  const space = getSpaceConfig(alias, config);
  space[field] = value;
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n');
}
