import { PLUGIN_PREFIX } from '../constants';
import { normalizePluginName } from './util';

/** Names of the plugins bundled with structured-context. Each built-in plugin takes its `name` from here. */
export const BUILTIN_PLUGIN_NAMES = {
  markdown: `${PLUGIN_PREFIX}markdown`,
  mermaid: `${PLUGIN_PREFIX}mermaid`,
  miro: `${PLUGIN_PREFIX}miro`,
} as const;

const builtinNames = new Set<string>(Object.values(BUILTIN_PLUGIN_NAMES));

/** Whether a plugin name, with or without the prefix, names a built-in plugin. */
export function isBuiltinPluginName(name: string): boolean {
  return builtinNames.has(normalizePluginName(name));
}
