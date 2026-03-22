import type { AnySchemaObject } from 'ajv';
import type { SpaceContext, SpaceNode, UnresolvedRef } from '../types';

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
  parseIgnored?: string[];
  /** Plugin diagnostics: keyed scalar or list values. */
  diagnostics?: Record<string, number | string | string[]>;
  /** Broken/invalid wikilink refs collected during graph edge resolution. */
  unresolvedRefs?: UnresolvedRef[];
};

export type ParseHook = (context: PluginContext) => Promise<ParseResult | null>;

export type OstToolsPlugin = {
  name: string;
  /** JSON Schema used to validate the plugin's config block. Fields with `format: 'path'`
   * are resolved relative to the config directory by `resolveConfigPaths` in the loader. */
  configSchema: AnySchemaObject;
  parse?: ParseHook;
  // Future: canHandle?(context) → boolean | Promise<boolean> for deterministic routing.
  //   Intent: replace null-return fallthrough with explicit match/no-match. Orchestrator would
  //   require exactly one plugin to claim the space; ambiguity or no match is an error.
};
