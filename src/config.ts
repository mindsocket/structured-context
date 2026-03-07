import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import JSON5 from 'json5';

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
          templatePrefix: { type: 'string' },
          miroBoardId: { type: 'string' },
          miroFrameId: { type: 'string' },
        },
        required: ['alias', 'path'],
        additionalProperties: false,
      },
    },
    schema: { type: 'string' },
    templateDir: { type: 'string' },
    templatePrefix: { type: 'string' },
  },
  required: ['spaces'],
  additionalProperties: false,
};

export interface SpaceConfig {
  alias: string;
  path: string;
  schema?: string;
  templateDir?: string;
  templatePrefix?: string;
  miroBoardId?: string;
  miroFrameId?: string;
}

export interface Config {
  spaces: SpaceConfig[];
  schema?: string;
  templateDir?: string;
  templatePrefix?: string;
}

const packageDir = dirname(fileURLToPath(import.meta.url));

let _configPathOverride: string | undefined;

/** Override the config file path used by loadConfig/updateSpaceField. */
export function setConfigPath(path: string | undefined): void {
  _configPathOverride = path;
}

function configPath(): string {
  if (_configPathOverride) {
    return _configPathOverride;
  }
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

function resolveRelativePaths(config: Config, configDir: string): Config {
  const rel = (p: string | undefined): string | undefined => {
    if (!p || isAbsolute(p)) return p;
    return resolve(configDir, p);
  };
  return {
    ...config,
    schema: rel(config.schema),
    templateDir: rel(config.templateDir),
    spaces: config.spaces.map((s) => ({
      ...s,
      path: rel(s.path)!,
      schema: rel(s.schema),
      templateDir: rel(s.templateDir),
    })),
  };
}

function _loadConfig(path: string): Config {
  if (!existsSync(path)) {
    console.error(`Config file not found: ${path}`);
    process.exit(1);
  }

  const config = JSON5.parse(readFileSync(path, 'utf-8'));
  const ajv = new Ajv();
  const validate = ajv.compile(CONFIG_SCHEMA);

  if (!validate(config)) {
    console.error('Invalid config.json:', validate.errors);
    process.exit(1);
  }
  return config as unknown as Config;
}

export function loadConfig(): Config {
  const path = configPath();
  const config = _loadConfig(path);
  return resolveRelativePaths(config, dirname(resolve(path)));
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

export interface TemplateSettings {
  templateDir: string;
  templatePrefix: string;
}

/** Resolve template settings: space-level config > global config. */
export function resolveTemplateSettings(config: Config, space?: SpaceConfig): TemplateSettings {
  const templateDir = space?.templateDir ?? config.templateDir;
  if (!templateDir) {
    console.error('Error: templateDir is required in config.json (global or per-space)');
    process.exit(1);
  }
  const templatePrefix = space?.templatePrefix ?? config.templatePrefix ?? '';
  return { templateDir, templatePrefix };
}

/** Update a field on a space entry and persist config.json. */
export function updateSpaceField(alias: string, field: keyof SpaceConfig, value: string): void {
  const path = configPath();
  const config = _loadConfig(path);
  const space = config.spaces?.find((s: SpaceConfig) => s.alias === alias);
  if (!space) {
    throw new Error(`Unknown space config: "${alias}". Check config.json.`);
  }
  space[field] = value;
  writeFileSync(path, `${JSON5.stringify(config, null, 2)}\n`);
}
