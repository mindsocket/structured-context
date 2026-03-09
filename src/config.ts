import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import Ajv from 'ajv';
import JSON5 from 'json5';
import { bundledSchemasDir } from './schema';

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
          templateDir: { type: 'string' },
          templatePrefix: { type: 'string' },
          miroBoardId: { type: 'string' },
          miroFrameId: { type: 'string' },
          fieldMap: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['name', 'path'],
        additionalProperties: false,
      },
    },
    schema: { type: 'string' },
    templateDir: { type: 'string' },
    templatePrefix: { type: 'string' },
    includeSpacesFrom: { type: 'array', items: { type: 'string' } },
  },
  required: ['spaces'],
  additionalProperties: false,
};

export interface SpaceConfig {
  name: string;
  path: string;
  schema?: string;
  templateDir?: string;
  templatePrefix?: string;
  miroBoardId?: string;
  miroFrameId?: string;
  /**
   * Maps file/frontmatter field names to canonical field names expected by the schema.
   * Applied on read (frontmatter → schemaData) and reversed on write (template-sync).
   * Example: { "record_type": "type" } renames `record_type` in files to `type` internally.
   */
  fieldMap?: Record<string, string>;
}

export interface Config {
  spaces: SpaceConfig[];
  schema?: string;
  templateDir?: string;
  templatePrefix?: string;
  includeSpacesFrom?: string[];
}

let _configPathOverride: string | undefined;
const _spaceSourceFiles = new Map<string, string>();

/** Override the config file path used by loadConfig/updateSpaceField. */
export function setConfigPath(path: string | undefined): void {
  _configPathOverride = path;
  _spaceSourceFiles.clear(); // Clear cache when config path changes
}

export function configPath(): string {
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

/** Resolve spaceNameOrPath to a filesystem path. Falls through if not a space name. */
export function resolveSpacePath(spaceNameOrPath: string, config: Config): string {
  const space = config.spaces.find((s) => s.name === spaceNameOrPath);
  return space ? space.path : spaceNameOrPath;
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
export function resolveSchema(cliArg: string | undefined, config: Config, space?: SpaceConfig): string {
  return cliArg ?? space?.schema ?? config.schema ?? join(bundledSchemasDir, 'general.json');
}

export interface TemplateSettings {
  templateDir: string;
  templatePrefix: string;
}

/** Resolve template settings: space-level config > global config. */
export function resolveTemplateSettings(config: Config, space?: SpaceConfig): TemplateSettings {
  const templateDir = space?.templateDir ?? config.templateDir;
  if (!templateDir) {
    throw new Error('templateDir not found in config (global or per-space)');
  }
  const templatePrefix = space?.templatePrefix ?? config.templatePrefix ?? '';
  return { templateDir, templatePrefix };
}

/**
 * Apply field remapping to a data object.
 * Renames keys according to fieldMap (file field name → canonical field name).
 * Fields not in the map are passed through unchanged.
 */
export function applyFieldMap(
  data: Record<string, unknown>,
  fieldMap: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!fieldMap || Object.keys(fieldMap).length === 0) return data;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[fieldMap[key] ?? key] = value;
  }
  return result;
}

/**
 * Invert a fieldMap (file→canonical) to produce a reverse map (canonical→file).
 * Used for write operations (e.g. template-sync) to translate back to file field names.
 */
export function invertFieldMap(fieldMap: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fieldMap).map(([src, canonical]) => [canonical, src]));
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
