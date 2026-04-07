import type { AnySchemaObject } from 'ajv';
import { PLUGIN_PREFIX as _PLUGIN_PREFIX } from '../constants';
import type { SpaceGraph } from '../space-graph';
import type { BaseNode, SpaceContext } from '../types';

export const PLUGIN_PREFIX = _PLUGIN_PREFIX;
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
  nodes: BaseNode[];
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

/** A single render output format provided by a plugin. */
export type RenderFormat = {
  /** Short name, unique within the plugin (e.g. 'bullets', 'mermaid'). */
  name: string;
  /** Human-readable description shown in `render list`. */
  description: string;
};

/** Options passed to a render function. */
export type RenderOptions = {
  /** The format name being rendered (e.g. 'bullets', 'mermaid'). */
  format: string;
};

/**
 * The render hook on a plugin: declares available formats and handles rendering.
 * Unlike parse/templateSync (first-responder), render hooks are additive —
 * all formats from all plugins are available simultaneously.
 */
export type RenderHook = {
  formats: RenderFormat[];
  render: (context: PluginContext, graph: SpaceGraph, options: RenderOptions) => Promise<string> | string;
};

/**
 * Plugin contract:
 * - A hook not implemented on the plugin → that plugin is skipped for that operation.
 * - parse/templateSync return `T | null` → null means "didn't handle, try next plugin".
 * - render is additive: all plugins' formats are registered and dispatched by name.
 */
export type StructuredContextPlugin = {
  name: string;
  /** JSON Schema used to validate the plugin's config block. Fields with `format: 'path'`
   * are resolved relative to the config directory by `resolveConfigPaths` in the loader. */
  configSchema: AnySchemaObject;
  parse?: ParseHook;
  templateSync?: TemplateSyncHook;
  render?: RenderHook;
};
