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

/** The roots of the loaded config files. */
function configRoots(): string[] {
  return Array.from(getConfigSourceFiles()).map((f) => configRoot(f));
}

/**
 * Discover all available plugins: built-ins first, then any found in the plugins folder of
 * each config root (by default, the roots of the loaded config files). Does not load npm plugins
 * (those are only declared in space configs).
 */
export async function discoverPlugins(configDirs: string[] = configRoots()): Promise<StructuredContextPlugin[]> {
  const plugins: StructuredContextPlugin[] = [...builtinPlugins];
  const seenNames = new Set(builtinPlugins.map((p) => p.name));

  for (const configDir of new Set(configDirs)) {
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

/** A plugin with the config block a space declares for it, not yet validated. */
export type DeclaredPlugin = {
  plugin: StructuredContextPlugin;
  rawConfig: Record<string, unknown>;
};

/** The space's plugins: external ones from the map in declaration order, then the built-ins. */
async function declaredPlugins(
  pluginMap: Record<string, Record<string, unknown>>,
  configDir: string,
): Promise<DeclaredPlugin[]> {
  const declared: DeclaredPlugin[] = [];
  for (const [rawName, rawConfig] of Object.entries(pluginMap)) {
    const name = normalizePluginName(rawName);
    if (isBuiltinPluginName(name)) continue;
    if (!name.startsWith(PLUGIN_PREFIX)) {
      throw new Error(`Plugin name must start with "${PLUGIN_PREFIX}" (got "${rawName}")`);
    }
    declared.push({ plugin: await resolveExternalPlugin(name, configDir), rawConfig });
  }
  for (const builtin of builtinPlugins) {
    const rawConfig = pluginMap[builtin.name] ?? pluginMap[shortenPluginName(builtin.name)] ?? {};
    declared.push({ plugin: builtin, rawConfig });
  }
  return declared;
}

/**
 * Validate a plugin's config block against its configSchema. Fields annotated with
 * format:'path' are resolved relative to configDir first.
 */
export function configurePlugin({ plugin, rawConfig }: DeclaredPlugin, configDir: string): LoadedPlugin {
  const ajv = new Ajv2020();
  ajv.addFormat('path', (value: string) => value.length > 0 && !value.includes('\0'));
  const pluginConfig = resolveConfigPaths(plugin.configSchema, rawConfig, configDir);
  const validate = ajv.compile(plugin.configSchema);
  if (!validate(pluginConfig)) {
    throw new Error(`Invalid config for plugin "${plugin.name}": ${JSON.stringify(validate.errors)}`);
  }
  return { plugin, pluginConfig };
}

/**
 * Load plugins for a space, with their config validated.
 *
 * Built-in plugins are always included (with config from the map if declared, else {}).
 * External plugins are loaded from the map and come first, in declaration order.
 * Resolution order for external plugins: config-adjacent → npm.
 */
export async function loadPlugins(
  pluginMap: Record<string, Record<string, unknown>>,
  configDir: string,
): Promise<LoadedPlugin[]> {
  return (await declaredPlugins(pluginMap, configDir)).map((declared) => configurePlugin(declared, configDir));
}

/**
 * Every plugin a space can use: the ones it declares, then any other discovered plugin with
 * an empty config. Config is not validated, so a plugin with invalid config fails only when
 * it is used (see {@link configurePlugin}).
 */
export async function availablePlugins(
  pluginMap: Record<string, Record<string, unknown>>,
  configDir: string,
): Promise<DeclaredPlugin[]> {
  const available = await declaredPlugins(pluginMap, configDir);
  const names = new Set(available.map(({ plugin }) => plugin.name));
  for (const plugin of await discoverPlugins([configDir, ...configRoots()])) {
    if (!names.has(plugin.name)) available.push({ plugin, rawConfig: {} });
  }
  return available;
}
