import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { AnySchemaObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { getConfigSourceFiles } from '../config';
import { configRoot, resourceDir } from '../config/layout';
import { builtinPlugins } from '.';
import { isBuiltinPluginName } from './builtin-names';
import {
  CONFIG_PLUGINS_DIR,
  normalizePluginName,
  PLUGIN_PREFIX,
  type StructuredContextPlugin,
  shortenPluginName,
} from './util';

type PluginMap = Record<string, Record<string, unknown>>;

export type LoadedPlugin = {
  plugin: StructuredContextPlugin;
  pluginConfig: Record<string, unknown>;
};

/** The plugins a space uses, each with its validated config, in the order parse and templateSync try them. */
export async function loadPlugins(pluginMap: PluginMap, configDir: string): Promise<LoadedPlugin[]> {
  return [...(await namedPlugins(pluginMap, configDir)), ...builtinPlugins].map((plugin) => ({
    plugin,
    pluginConfig: validatePluginConfig(plugin, pluginMap, configDir),
  }));
}

/** Every available plugin: the built-ins, the plugins a space names, and those in config roots' plugins folders. */
export async function discoverPlugins(space?: {
  pluginMap: PluginMap;
  configDir: string;
}): Promise<StructuredContextPlugin[]> {
  const plugins = [...builtinPlugins, ...(space ? await namedPlugins(space.pluginMap, space.configDir) : [])];
  const names = new Set(plugins.map((p) => p.name));
  const roots = new Set([...(space ? [space.configDir] : []), ...[...getConfigSourceFiles()].map(configRoot)]);

  for (const root of roots) {
    const pluginsDir = resourceDir(root, CONFIG_PLUGINS_DIR);
    for (const entry of pluginsDir ? readdirSync(pluginsDir) : []) {
      if (!entry.startsWith(PLUGIN_PREFIX) || names.has(entry)) continue;
      const plugin = await importPlugin(entry, root);
      if (names.has(plugin.name)) continue;
      plugins.push(plugin);
      names.add(plugin.name);
    }
  }
  return plugins;
}

/** A plugin's config block from a plugin map ({} if absent), validated against its configSchema. */
export function validatePluginConfig(
  plugin: StructuredContextPlugin,
  pluginMap: PluginMap,
  configDir: string,
): Record<string, unknown> {
  const rawConfig = pluginMap[plugin.name] ?? pluginMap[shortenPluginName(plugin.name)] ?? {};
  const pluginConfig = resolveConfigPaths(plugin.configSchema, rawConfig, configDir);
  const ajv = new Ajv2020();
  ajv.addFormat('path', (value: string) => value.length > 0 && !value.includes('\0'));
  const validate = ajv.compile(plugin.configSchema);
  if (!validate(pluginConfig)) {
    throw new Error(`Invalid config for plugin "${plugin.name}": ${JSON.stringify(validate.errors)}`);
  }
  return pluginConfig;
}

/** The non-built-in plugins a plugin map names, in map order. */
async function namedPlugins(pluginMap: PluginMap, configDir: string): Promise<StructuredContextPlugin[]> {
  const plugins: StructuredContextPlugin[] = [];
  for (const rawName of Object.keys(pluginMap)) {
    const name = normalizePluginName(rawName);
    if (isBuiltinPluginName(name)) continue;
    if (!name.startsWith(PLUGIN_PREFIX)) {
      throw new Error(`Plugin name must start with "${PLUGIN_PREFIX}" (got "${rawName}")`);
    }
    plugins.push(await importPlugin(name, configDir));
  }
  return plugins;
}

/** Import a plugin by name from the config root's plugins folder, else as a package. */
async function importPlugin(name: string, configDir: string): Promise<StructuredContextPlugin> {
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

function resolveConfigPaths(
  schema: AnySchemaObject,
  config: Record<string, unknown>,
  configDir: string,
): Record<string, unknown> {
  const props = schema.properties as Record<string, AnySchemaObject> | undefined;
  if (!props) return config;
  const result = { ...config };
  for (const [key, propSchema] of Object.entries(props)) {
    const value = result[key];
    if (propSchema.format === 'path' && typeof value === 'string' && !isAbsolute(value)) {
      result[key] = resolve(configDir, value);
    }
  }
  return result;
}
