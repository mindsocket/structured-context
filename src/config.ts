import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import JSON5 from 'json5';
import { ENV_CONFIG_VAR, XDG_CONFIG_DIR } from './constants';
import {
  normalizePluginName,
  resolvePluginSchemasDir,
  resolveSpacePluginSchemas,
  shortenPluginName,
} from './plugins/util';
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
  anyOf: [{ required: ['spaces'] }, { required: ['includeSpacesFrom'] }],
  additionalProperties: false,
};

export type SpaceConfig = {
  name: string;
  path: string;
  schema?: string;
  /** Plugin name → plugin config map. Overrides top-level plugins when set. */
  plugins?: Record<string, Record<string, unknown>>;
  /** Named filter views for this space. Keys are view names; values contain the filter expression. */
  views?: Record<string, { expression: string }>;
  /**
   * Directory of the config file that defined this space, used to anchor relative plugin-config
   * paths. Set by loadConfig; absent for a hand-assembled Config, whose callers must pass an
   * explicit configDir to createSpaceContext. Not persisted by updateSpaceField.
   */
  sourceDir?: string;
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
    if (p.startsWith('./') || p.startsWith('../')) {
      return resolve(configDir, p);
    }
    return p;
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
  const ajv = new Ajv2020();
  const validate = ajv.compile(CONFIG_SCHEMA);

  if (!validate(config)) {
    throw new Error(`Invalid config in ${path}: ${JSON.stringify(validate.errors)}`);
  }
  if (!config.spaces) config.spaces = [];
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
  const mainSourceDir = dirname(resolve(path));
  for (const space of config.spaces) {
    _spaceSourceFiles.set(space.name, path);
    space.sourceDir = mainSourceDir;
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
      const includeSourceDir = dirname(resolvedIncludePath);
      for (const space of includedConfig.spaces) {
        _spaceSourceFiles.set(space.name, resolvedIncludePath);
        space.sourceDir = includeSourceDir;
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

/**
 * Resolve a schema identifier or path to an absolute file path.
 *
 * Precedence:
 * 1. Absolute path or URL → used directly.
 * 2. Explicit relative path (./... or ../...) → resolved relative to configDir.
 * 3. Plugin-qualified path (e.g. "sctx-wardley-mapping/wardley_map.json" or "wardley-mapping/wardley_map.json"):
 *    resolved against the matching loaded plugin's schemasDir.
 * 4. Simple filename without directory (e.g. "wardley_map.json" or "strategy_general.json"):
 *    - configDir/filename if it exists
 *    - plugin.schemasDir/filename for any loaded plugin with schemasDir
 *    - bundledSchemasDir/filename if it exists
 *    - fallback: configDir/filename
 */
export function resolveSchemaPath(
  rawSchema: string | undefined,
  configDir: string,
  space?: SpaceConfig,
  config?: Config,
): string {
  if (!rawSchema) {
    throw new Error('No schema configured. Set "schema" in the space config or at the top level of the config file.');
  }

  if (isAbsolute(rawSchema) || isUrl(rawSchema)) {
    return rawSchema;
  }

  if (rawSchema.startsWith('./') || rawSchema.startsWith('../')) {
    return resolve(configDir, rawSchema);
  }

  if (rawSchema.includes('/') || rawSchema.includes('\\')) {
    const normalizedSlash = rawSchema.replace(/\\/g, '/');
    const slashIdx = normalizedSlash.indexOf('/');
    const prefix = normalizedSlash.slice(0, slashIdx);
    const subPath = normalizedSlash.slice(slashIdx + 1);

    const pluginSchemasDir = resolvePluginSchemasDir(prefix, configDir);
    if (pluginSchemasDir) {
      const candidate = resolve(pluginSchemasDir, subPath);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    // Check if relative to configDir exists
    const localCandidate = resolve(configDir, rawSchema);
    if (existsSync(localCandidate)) {
      return localCandidate;
    }

    // If plugin schemas dir was found, return candidate under it
    if (pluginSchemasDir) {
      return resolve(pluginSchemasDir, subPath);
    }

    return localCandidate;
  }

  // Simple filename without directory:
  // 1. configDir/filename
  const localCandidate = resolve(configDir, rawSchema);
  if (existsSync(localCandidate)) {
    return localCandidate;
  }

  // 2. Plugin schemas from declared space / config plugins
  if (space || config) {
    const pluginSources = resolveSpacePluginSchemas(space, config ?? { spaces: [] }, configDir);
    for (const source of pluginSources) {
      const pluginCandidate = resolve(source.schemasDir, rawSchema);
      if (existsSync(pluginCandidate)) {
        return pluginCandidate;
      }
    }
  }

  // 3. Bundled schemas
  const bundledCandidate = join(bundledSchemasDir, rawSchema);
  if (existsSync(bundledCandidate)) {
    return bundledCandidate;
  }

  return localCandidate;
}

/** Resolve schema path: CLI arg > space-level config > global config. Throws if none configured. */
export function resolveSchema(config: Config, space?: SpaceConfig, options?: { configDir?: string }): string {
  const schema = space?.schema ?? config.schema;
  if (!schema) {
    throw new Error('No schema configured. Set "schema" in the space config or at the top level of the config file.');
  }
  const configDir = options?.configDir ?? space?.sourceDir;
  if (configDir) {
    return resolveSchemaPath(schema, configDir, space, config);
  }
  return schema;
}

/** Update a string field on a space entry and persist config. When `plugin` is given, updates that field inside `space.plugins[plugin]` instead. */
export function updateSpaceField(spaceName: string, field: string, value: string, plugin?: string): void {
  const sourcePath = _spaceSourceFiles.get(spaceName);
  if (!sourcePath) throw new Error(`Space "${spaceName}" not found in any config file`);
  const config = _loadConfig(sourcePath);
  const space = config.spaces?.find((s: SpaceConfig) => s.name === spaceName);
  if (!space) throw new Error(`Unknown space config: "${spaceName}". Check config.`);
  if (plugin !== undefined) {
    if (!space.plugins) space.plugins = {};
    const normalized = normalizePluginName(plugin);
    const shortName = shortenPluginName(normalized);
    const existingKey = Object.keys(space.plugins).find((k) => k === normalized || k === shortName) ?? normalized;
    if (!space.plugins[existingKey]) space.plugins[existingKey] = {};
    space.plugins[existingKey][field] = value;
  } else {
    (space as unknown as Record<string, unknown>)[field] = value;
  }
  writeFileSync(sourcePath, `${JSON5.stringify(config, null, 2)}\n`);
}
