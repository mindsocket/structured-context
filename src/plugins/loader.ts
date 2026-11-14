import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { AnySchemaObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { getConfigSourceFiles } from '../config';
import { configRoot, resourceDir } from '../config/layout';
import type { SpaceContext } from '../types';
import { builtinPlugins } from '.';
import { isBuiltinPluginName } from './builtin-names';
import {
  CONFIG_PLUGINS_DIR,
  normalizePluginName,
  PLUGIN_PREFIX,
  pluginResourceDir,
  resolvePluginDir,
  type StructuredContextPlugin,
  shortenPluginName,
  spacePluginNames,
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

/** Import a plugin by its `sctx-` name: from the config root's plugins folder if it is there, else as a package. */
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

/**
 * The plugins a space uses: the ones its plugin map names, in map order, then the built-ins.
 * A named plugin resolves from the config root's plugins folder, then npm.
 */
async function spacePlugins(
  pluginMap: Record<string, Record<string, unknown>>,
  configDir: string,
): Promise<StructuredContextPlugin[]> {
  const named: StructuredContextPlugin[] = [];
  for (const rawName of Object.keys(pluginMap)) {
    const name = normalizePluginName(rawName);
    if (isBuiltinPluginName(name)) continue;
    if (!name.startsWith(PLUGIN_PREFIX)) {
      throw new Error(`Plugin name must start with "${PLUGIN_PREFIX}" (got "${rawName}")`);
    }
    named.push(await importPlugin(name, configDir));
  }
  return [...named, ...builtinPlugins];
}

/** The roots of the loaded config files (the main config and the configs it includes), after `configDir` if given. */
function configRoots(configDir?: string): string[] {
  const loaded = Array.from(getConfigSourceFiles()).map((f) => configRoot(f));
  return [...new Set(configDir ? [configDir, ...loaded] : loaded)];
}

/** The names of the plugins in a config root's plugins folder. */
function pluginsFolderEntries(configDir: string): string[] {
  const pluginsDir = resourceDir(configDir, CONFIG_PLUGINS_DIR);
  return pluginsDir ? readdirSync(pluginsDir).filter((e) => e.startsWith(PLUGIN_PREFIX)) : [];
}

/**
 * Discover all available plugins: the built-ins, then any found in the plugins folder of
 * each loaded config file's root (the main config and the configs it includes).
 * Given a space, starts from the plugins it uses instead of the built-ins, and also searches
 * its config root's plugins folder.
 */
export async function discoverPlugins(space?: {
  pluginMap: Record<string, Record<string, unknown>>;
  configDir: string;
}): Promise<StructuredContextPlugin[]> {
  const plugins = space ? await spacePlugins(space.pluginMap, space.configDir) : [...builtinPlugins];
  const seenNames = new Set(plugins.map((p) => p.name));

  for (const configDir of configRoots(space?.configDir)) {
    for (const entry of pluginsFolderEntries(configDir)) {
      if (seenNames.has(entry)) continue;
      const plugin = await importPlugin(entry, configDir);
      if (seenNames.has(plugin.name)) continue;
      plugins.push(plugin);
      seenNames.add(plugin.name);
    }
  }
  return plugins;
}

/**
 * A plugin's config block from the space's plugin map ({} if absent), validated against its
 * configSchema. Fields annotated with format:'path' are resolved relative to configDir first.
 */
export function validatePluginConfig(
  plugin: StructuredContextPlugin,
  pluginMap: Record<string, Record<string, unknown>>,
  configDir: string,
): Record<string, unknown> {
  const rawConfig = pluginMap[plugin.name] ?? pluginMap[shortenPluginName(plugin.name)] ?? {};
  const ajv = new Ajv2020();
  ajv.addFormat('path', (value: string) => value.length > 0 && !value.includes('\0'));
  const pluginConfig = resolveConfigPaths(plugin.configSchema, rawConfig, configDir);
  const validate = ajv.compile(plugin.configSchema);
  if (!validate(pluginConfig)) {
    throw new Error(`Invalid config for plugin "${plugin.name}": ${JSON.stringify(validate.errors)}`);
  }
  return pluginConfig;
}

/** The plugins a space uses, each with its validated config. Parse and templateSync try them in this order. */
export async function loadPlugins(
  pluginMap: Record<string, Record<string, unknown>>,
  configDir: string,
): Promise<LoadedPlugin[]> {
  return (await spacePlugins(pluginMap, configDir)).map((plugin) => ({
    plugin,
    pluginConfig: validatePluginConfig(plugin, pluginMap, configDir),
  }));
}

/** Every folder of one kind of resource available to a space: config roots' first, then plugins' (named by the space or in a plugins folder). */
export function resourceDirs(kind: string, context: SpaceContext): Array<{ dir: string; plugin?: string }> {
  const roots = configRoots(context.configDir);
  const pluginDirs = new Map<string, string>();
  const addPlugin = (name: string, fromDir: string) => {
    const short = shortenPluginName(name);
    const dir = !pluginDirs.has(short) && resolvePluginDir(name, fromDir);
    if (dir) pluginDirs.set(short, dir);
  };
  for (const root of roots) for (const entry of pluginsFolderEntries(root)) addPlugin(entry, root);
  for (const name of spacePluginNames(context.space, context.config)) addPlugin(name, context.configDir);

  return [
    ...roots.flatMap((root) => {
      const dir = resourceDir(root, kind);
      return dir ? [{ dir }] : [];
    }),
    ...[...pluginDirs].flatMap(([plugin, pluginDir]) => {
      const dir = pluginResourceDir(pluginDir, kind);
      return dir ? [{ dir, plugin }] : [];
    }),
  ];
}
