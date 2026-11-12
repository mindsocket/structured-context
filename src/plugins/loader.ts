import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { AnySchemaObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { configRoot, getConfigSourceFiles, resourceDir } from '../config';
import { builtinPlugins } from '.';
import { isBuiltinPluginName } from './builtin-names';
import {
  CONFIG_PLUGINS_DIR,
  normalizePluginName,
  PLUGIN_PREFIX,
  type StructuredContextPlugin,
  shortenPluginName,
} from './util';

export type LoadedPlugin = {
  plugin: StructuredContextPlugin;
  pluginConfig: Record<string, unknown>;
};

/**
 * Walk a plugin's configSchema and resolve any string fields annotated with
 * format:'path' relative to configDir.
 */
function resolveConfigPaths(
  schema: AnySchemaObject,
  config: Record<string, unknown>,
  configDir: string,
): Record<string, unknown> {
  const props = schema.properties as Record<string, AnySchemaObject> | undefined;
  if (!props) return config;
  const result = { ...config };
  for (const [key, propSchema] of Object.entries(props)) {
    if (propSchema.format === 'path' && typeof result[key] === 'string') {
      const value = result[key] as string;
      if (!isAbsolute(value)) {
        result[key] = resolve(configDir, value);
      }
    }
  }
  return result;
}

/**
 * Resolve an external plugin by canonical name.
 * Resolution order: the config root's plugins folder → npm (import(name)).
 */
async function resolveExternalPlugin(name: string, configDir: string): Promise<StructuredContextPlugin> {
  const pluginsDir = resourceDir(configDir, CONFIG_PLUGINS_DIR);
  const localPath = pluginsDir && resolve(join(pluginsDir, name));
  const local = localPath && (existsSync(localPath) || existsSync(`${localPath}.ts`));
  const module = local ? await import(localPath) : await import(name);
  const plugin = (module as { default?: StructuredContextPlugin }).default ?? (module as StructuredContextPlugin);
  if (!plugin || typeof plugin.name !== 'string') {
    throw new Error(`Plugin "${name}" must export a StructuredContextPlugin as its default export`);
  }
  return plugin;
}

/**
 * Discover all available plugins: built-ins first, then any found in the plugins folder of
 * each loaded config file's root. Does not load npm plugins
 * (those are only declared in space configs).
 */
export async function discoverPlugins(): Promise<StructuredContextPlugin[]> {
  const configDirs = [...new Set(Array.from(getConfigSourceFiles()).map((f) => configRoot(f)))];

  const plugins: StructuredContextPlugin[] = [...builtinPlugins];
  const seenNames = new Set(builtinPlugins.map((p) => p.name));

  for (const configDir of configDirs) {
    const pluginsDir = resourceDir(configDir, CONFIG_PLUGINS_DIR);
    if (pluginsDir) {
      const entries = readdirSync(pluginsDir).filter((e) => e.startsWith(PLUGIN_PREFIX));
      for (const entry of entries) {
        if (!seenNames.has(entry)) {
          plugins.push(await resolveExternalPlugin(entry, configDir));
          seenNames.add(entry);
        }
      }
    }
  }
  return plugins;
}

/**
 * Load plugins for a space.
 *
 * Built-in plugins are always included (with config from the map if declared, else {}).
 * External plugins are loaded from the map and prepended in declaration order.
 * Resolution order for external plugins: config-adjacent → npm.
 * Fields annotated with format:'path' in a plugin's configSchema are resolved
 * relative to configDir.
 */
export async function loadPlugins(
  pluginMap: Record<string, Record<string, unknown>>,
  configDir: string,
): Promise<LoadedPlugin[]> {
  const ajv = new Ajv2020();
  ajv.addFormat('path', (value: string) => value.length > 0 && !value.includes('\0'));
  const loaded: LoadedPlugin[] = [];

  // External plugins: entries in the map that are not built-in names
  for (const [rawName, rawConfig] of Object.entries(pluginMap)) {
    const name = normalizePluginName(rawName);
    if (isBuiltinPluginName(name)) continue;
    if (!name.startsWith(PLUGIN_PREFIX)) {
      throw new Error(`Plugin name must start with "${PLUGIN_PREFIX}" (got "${rawName}")`);
    }
    const plugin = await resolveExternalPlugin(name, configDir);
    const pluginConfig = resolveConfigPaths(plugin.configSchema, rawConfig, configDir);
    const validate = ajv.compile(plugin.configSchema);
    if (!validate(pluginConfig)) {
      throw new Error(`Invalid config for plugin "${name}": ${JSON.stringify(validate.errors)}`);
    }
    loaded.push({ plugin, pluginConfig });
  }

  // Built-in plugins: always loaded, config taken from map if declared (with or without prefix)
  for (const builtin of builtinPlugins) {
    const rawConfig = pluginMap[builtin.name] ?? pluginMap[shortenPluginName(builtin.name)] ?? {};
    const pluginConfig = resolveConfigPaths(builtin.configSchema, rawConfig, configDir);
    const validate = ajv.compile(builtin.configSchema);
    if (!validate(pluginConfig)) {
      throw new Error(`Invalid config for plugin "${builtin.name}": ${JSON.stringify(validate.errors)}`);
    }
    loaded.push({ plugin: builtin, pluginConfig });
  }

  return loaded;
}
