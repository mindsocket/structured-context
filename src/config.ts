import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { parse } from 'jsonc-parser';

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
          schema: { type: 'string' },
          templateDir: { type: 'string' },
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
  schema?: string;
  templateDir?: string;
  miroBoardId?: string;
  miroFrameId?: string;
}

export interface Config {
  spaces: SpaceConfig[];
  schema?: string;
  templateDir?: string;
}

const packageDir = dirname(fileURLToPath(import.meta.url));

function configPath(): string {
  if (process.env.OST_TOOLS_CONFIG) {
    return process.env.OST_TOOLS_CONFIG;
  }
  const xdgBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const xdgPath = join(xdgBase, 'ost-tools', 'config.json');
  if (existsSync(xdgPath)) {
    return xdgPath;
  }
  const cwdPath = join(process.cwd(), 'config.json');
  if (existsSync(cwdPath)) {
    return cwdPath;
  }
  return xdgPath;
}

export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) {
    return { spaces: [] };
  }

  const config = parse(readFileSync(path, 'utf-8'));
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
  const space = config.spaces.find((s) => s.alias === aliasOrPath);
  return space ? space.path : aliasOrPath;
}

/** Get the full space config entry by alias. Throws if not found. */
export function getSpaceConfig(alias: string, config: Config): SpaceConfig {
  const space = config.spaces.find((s) => s.alias === alias);
  if (!space) {
    throw new Error(`Unknown space config: "${alias}". Check config.json.`);
  }
  return space;
}

/** Resolve schema path: CLI arg > space-level config > global config > hardcoded default. */
export function resolveSchema(cliArg: string | undefined, config: Config, space?: SpaceConfig): string {
  return cliArg ?? space?.schema ?? config.schema ?? join(packageDir, '..', 'schemas', 'general.json');
}

/** Resolve template dir: CLI arg > space-level config > global config > error. */
export function resolveTemplateDir(cliArg: string | undefined, config: Config, space?: SpaceConfig): string {
  const dir = cliArg ?? space?.templateDir ?? config.templateDir;
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
  const path = configPath();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
