import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import Ajv from 'ajv';
import { JSON5 } from 'bun';
import { ENV_CONFIG_VAR, XDG_CONFIG_DIR } from './constants';
import { normalizePluginName } from './plugins/util';
import { bundledSchemasDir } from './schema/schema';

const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    spaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', pattern: '^[a-z0-9_-]+$' },
          path: { type: 'string' },
          schema: { type: 'string' },
          miroBoardId: { type: 'string' },
          miroFrameId: { type: 'string' },
          plugins: { type: 'object', additionalProperties: { type: 'object' } },
          views: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: { expression: { type: 'string', minLength: 1 } },
              required: ['expression'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'path'],
        additionalProperties: false,
      },
    },
    schema: { type: 'string' },
    includeSpacesFrom: { type: 'array', items: { type: 'string' } },
  },
  required: ['spaces'],
  additionalProperties: false,
};

export type SpaceConfig = {
  name: string;
  path: string;
  schema?: string;
  miroBoardId?: string;
  miroFrameId?: string;
  /** Plugin name → plugin config map. Overrides top-level plugins when set. */
  plugins?: Record<string, Record<string, unknown>>;
  /** Named filter views for this space. Keys are view names; values contain the filter expression. */
  views?: Record<string, { expression: string }>;
};

export type Config = {
  spaces: SpaceConfig[];
  schema?: string;
  includeSpacesFrom?: string[];
};

let _configPathOverride: string | undefined;
const _spaceSourceFiles = new Map<string, string>();

/** Override the config file path used by loadConfig/updateSpaceField. */
export function setConfigPath(path: string | undefined): void {
  _configPathOverride = path;
  _spaceSourceFiles.clear(); // Clear cache when config path changes
}

/** Get all config file paths that were loaded (main config + included configs). */
export function getConfigSourceFiles(): Set<string> {
  if (_spaceSourceFiles.size === 0) {
    loadConfig();
  }
  return new Set(_spaceSourceFiles.values());
}

/**
 * Get the directory of the config file that defines a given space.
 */
export function getSpaceConfigDir(spaceName: string): string {
  if (_spaceSourceFiles.size === 0) {
    loadConfig();
  }
  const spaceConfigPath = _spaceSourceFiles.get(spaceName);
  if (!spaceConfigPath) throw new Error('Space config path not found');
  return dirname(spaceConfigPath);
}

export function configPath(): string {
  if (_configPathOverride) {
    return _configPathOverride;
  }
  if (process.env[ENV_CONFIG_VAR]) {
    return process.env[ENV_CONFIG_VAR]!;
  }
  const xdgBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const xdgPath = join(xdgBase, XDG_CONFIG_DIR, 'config.json');
  if (existsSync(xdgPath)) {
    return xdgPath;
  }
  const cwdPath = join(process.cwd(), 'config.json');
  if (existsSync(cwdPath)) {
    return cwdPath;
  }
  return xdgPath;
}

function normalizePlugins(
  plugins: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!plugins) return undefined;
  return Object.fromEntries(Object.entries(plugins).map(([name, cfg]) => [normalizePluginName(name), cfg]));
}

function isUrl(p: string): boolean {
  return /^https?:\/\//i.test(p);
}

function resolveRelativePaths(config: Config, configDir: string): Config {
  const rel = (p: string | undefined): string | undefined => {
    if (!p || isAbsolute(p) || isUrl(p)) return p;
    return resolve(configDir, p);
  };
  const relSchema = (p: string | undefined): string | undefined => {
    if (!p || isAbsolute(p) || isUrl(p)) return p;
    if (!p.includes('/') && !p.includes('\\')) {
      const localPath = resolve(configDir, p);
      if (existsSync(localPath)) return localPath;
      return join(bundledSchemasDir, p);
    }
    return resolve(configDir, p);
  };
  return {
    ...config,
    schema: relSchema(config.schema),
    spaces: config.spaces.map((s) => ({
      ...s,
      path: rel(s.path)!,
      schema: relSchema(s.schema),
      plugins: normalizePlugins(s.plugins),
    })),
  };
}

function _loadConfig(path: string): Config {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }

  const config = JSON5.parse(readFileSync(path, 'utf-8'));
  const ajv = new Ajv();
  const validate = ajv.compile(CONFIG_SCHEMA);

  if (!validate(config)) {
    throw new Error(`Invalid config in ${path}: ${JSON.stringify(validate.errors)}`);
  }
  return config as unknown as Config;
}

export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) {
    console.warn(`Config file not found: ${path}`);
    return { spaces: [] };
  }
  const config = _loadConfig(path);
  _spaceSourceFiles.clear();
  // Track which spaces come from the main config file
  for (const space of config.spaces) {
    _spaceSourceFiles.set(space.name, path);
  }
  // Load includeSpacesFrom configs and merge their spaces in, with later entries taking precedence over earlier ones
  if (config.includeSpacesFrom) {
    for (const includePath of config.includeSpacesFrom) {
      // Resolve relative to the main config file
      const resolvedIncludePath = isAbsolute(includePath) ? includePath : resolve(dirname(path), includePath);
      const includedConfig = resolveRelativePaths(_loadConfig(resolvedIncludePath), dirname(resolvedIncludePath));
      if (includedConfig.spaces.some((s) => config.spaces.some((existing) => existing.name === s.name))) {
        throw new Error(`Included config contains spaces with duplicate names: ${resolvedIncludePath}`);
      }
      // Track which spaces come from this included config file
      for (const space of includedConfig.spaces) {
        _spaceSourceFiles.set(space.name, resolvedIncludePath);
      }
      config.spaces.push(...includedConfig.spaces);
    }
  }
  return resolveRelativePaths(config, dirname(resolve(path)));
}

/** Get the full space config entry by name. Throws if not found. */
export function getSpaceConfig(name: string, config: Config): SpaceConfig {
  const space = config.spaces.find((s) => s.name === name);
  if (!space) {
    throw new Error(`Unknown space: "${name}". Check config.`);
  }
  return space;
}

/** Resolve schema path: CLI arg > space-level config > global config > hardcoded default. */
export function resolveSchema(config: Config, space?: SpaceConfig): string {
  return space?.schema ?? config.schema ?? join(bundledSchemasDir, 'general.json');
}

type StringFields<T> = { [K in keyof T]: T[K] extends string | undefined ? K : never }[keyof T];

/** Update a string field on a space entry and persist config. */
export function updateSpaceField(spaceName: string, field: StringFields<SpaceConfig>, value: string): void {
  const sourcePath = _spaceSourceFiles.get(spaceName);
  if (!sourcePath) {
    throw new Error(`Space "${spaceName}" not found in any config file`);
  }
  const config = _loadConfig(sourcePath);
  const space = config.spaces?.find((s: SpaceConfig) => s.name === spaceName);
  if (!space) {
    throw new Error(`Unknown space config: "${spaceName}". Check config.`);
  }
  (space as unknown as Record<string, unknown>)[field as string] = value;
  writeFileSync(sourcePath, `${JSON5.stringify(config, null, 2)}\n`);
}
