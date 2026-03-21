import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import Ajv, { type AnySchemaObject } from 'ajv';
import { builtinPlugins } from '.';
import { CONFIG_PLUGINS_DIR, normalizePluginName, type OstToolsPlugin, PLUGIN_PREFIX } from './util';

export type LoadedPlugin = {
  plugin: OstToolsPlugin;
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
 * Resolution order: config-adjacent ({configDir}/plugins/{name}) → npm (import(name)).
 */
async function resolveExternalPlugin(name: string, configDir: string): Promise<OstToolsPlugin> {
  const localPath = join(configDir, CONFIG_PLUGINS_DIR, name);
  const module = existsSync(localPath) || existsSync(`${localPath}.ts`) ? await import(localPath) : await import(name);
  const plugin = (module as { default?: OstToolsPlugin }).default ?? (module as OstToolsPlugin);
  if (!plugin || typeof plugin.name !== 'string') {
    throw new Error(`Plugin "${name}" must export an OstToolsPlugin as its default export`);
  }
  return plugin;
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
  const builtinsByName = new Map(builtinPlugins.map((p) => [p.name, p]));
  const ajv = new Ajv();
  ajv.addFormat('path', () => true);
  const loaded: LoadedPlugin[] = [];

  // External plugins: entries in the map that are not built-in names
  for (const [rawName, rawConfig] of Object.entries(pluginMap)) {
    const name = normalizePluginName(rawName);
    if (builtinsByName.has(name)) continue;
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
    const rawConfig = pluginMap[builtin.name] ?? pluginMap[builtin.name.slice(PLUGIN_PREFIX.length)] ?? {};
    const pluginConfig = resolveConfigPaths(builtin.configSchema, rawConfig, configDir);
    const validate = ajv.compile(builtin.configSchema);
    if (!validate(pluginConfig)) {
      throw new Error(`Invalid config for plugin "${builtin.name}": ${JSON.stringify(validate.errors)}`);
    }
    loaded.push({ plugin: builtin, pluginConfig });
  }

  return loaded;
}
