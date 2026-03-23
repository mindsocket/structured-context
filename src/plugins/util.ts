import type { AnySchemaObject } from 'ajv';
import type { SpaceContext, SpaceNode } from '../types';

export const PLUGIN_PREFIX = 'ost-tools-';
export const CONFIG_PLUGINS_DIR = 'plugins';

/** Normalize a plugin name to its canonical prefixed form. */
export function normalizePluginName(name: string): string {
  return name.startsWith(PLUGIN_PREFIX) ? name : `${PLUGIN_PREFIX}${name}`;
}

export type PluginContext = SpaceContext & {
  /** Validated config for this plugin invocation. */
  pluginConfig: Record<string, unknown>;
};

export type ParseResult = {
  nodes: SpaceNode[];
  /** Paths/items the plugin skipped during parsing, for any reason. */
  parseIgnored: string[];
  /** Plugin diagnostics: keyed scalar or list values. */
  diagnostics: Record<string, number | string | string[]>;
};

export type ParseHook = (context: PluginContext) => Promise<ParseResult | null>;

export type TemplateSyncOptions = {
  dryRun?: boolean;
  createMissing?: boolean;
};

export type TemplateSyncHook = (context: PluginContext, options: TemplateSyncOptions) => Promise<true | null>;

/**
 * Plugin contract:
 * - A hook not implemented on the plugin → that plugin is skipped for that operation.
 * - A hook returns `T | null` → null means "didn't handle, try next plugin".
 * - The orchestrator accepts the first non-null result; if no plugin handles, it throws.
 */
export type OstToolsPlugin = {
  name: string;
  /** JSON Schema used to validate the plugin's config block. Fields with `format: 'path'`
   * are resolved relative to the config directory by `resolveConfigPaths` in the loader. */
  configSchema: AnySchemaObject;
  parse?: ParseHook;
  templateSync?: TemplateSyncHook;
};
