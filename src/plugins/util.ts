import type { AnySchemaObject } from 'ajv';
import type { Config, SpaceConfig } from '../config';
import type { SchemaMetadata, SpaceNode } from '../types';

export const PLUGIN_PREFIX = 'ost-tools-';
export const CONFIG_PLUGINS_DIR = 'plugins';

/** Normalize a plugin name to its canonical prefixed form. */
export function normalizePluginName(name: string): string {
  return name.startsWith(PLUGIN_PREFIX) ? name : `${PLUGIN_PREFIX}${name}`;
}

export type PluginContext = {
  /** Absolute path to the space (file or directory). */
  spacePath: string;
  /** Matching space config entry, if the path is a registered space. */
  space: SpaceConfig | undefined;
  /** Full loaded config. */
  config: Config;
  /** Absolute path to the resolved schema. */
  resolvedSchemaPath: string;
  /** Parsed schema metadata. */
  metadata: SchemaMetadata;
  /** Validated config for this plugin invocation. */
  pluginConfig: Record<string, unknown>;
};

export type ParseResult = {
  nodes: SpaceNode[];
  /** Paths/items the plugin skipped during parsing, for any reason. */
  parseIgnored?: string[];
  /** Plugin diagnostics: keyed scalar or list values. */
  diagnostics?: Record<string, number | string | string[]>;
};

export type ParseHook = (context: PluginContext) => Promise<ParseResult | null>;

export type OstToolsPlugin = {
  name: string;
  /** JSON Schema used to validate the plugin's config block.
   * TODO: support a path annotation (e.g. format or keyword) so the loader can resolve
   * config fields that are filesystem paths relative to the config file, rather than
   * each plugin hardcoding that knowledge in the core config resolver. */
  configSchema: AnySchemaObject;
  parse?: ParseHook;
  // Future: canHandle?(context) → boolean | Promise<boolean> for deterministic routing.
  //   Intent: replace null-return fallthrough with explicit match/no-match. Orchestrator would
  //   require exactly one plugin to claim the space; ambiguity or no match is an error.
};
