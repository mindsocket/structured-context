import { posix } from 'node:path';
import * as jsYaml from 'js-yaml';
import { CORE_SCHEMA, type DumpOptions, dump, load, type Type } from 'js-yaml';
import type { TypeInferenceConfig } from '.';

export function inferTypeFromPath(
  filePath: string,
  config: TypeInferenceConfig,
  knownTypes: Set<string>,
  typeAliases: Record<string, string> | undefined,
): string | undefined {
  if (config.mode === 'off') return undefined;

  const normalized = filePath.replace(/\\/g, '/');
  const dir = posix.dirname(normalized);
  if (dir === '.') return undefined;

  if (config.folderMap) {
    const normalizedMap = Object.fromEntries(
      Object.entries(config.folderMap).map(([k, v]) => [k.replace(/\\/g, '/').replace(/\/+$/, ''), v]),
    );

    let bestKey: string | undefined;
    for (const key of Object.keys(normalizedMap)) {
      if (dir === key || dir.startsWith(`${key}/`)) {
        if (!bestKey || key.length > bestKey.length) bestKey = key;
      }
    }

    if (!bestKey) return undefined;

    const value = normalizedMap[bestKey]!;
    if (typeAliases?.[value] !== undefined) return typeAliases[value];
    if (knownTypes.has(value)) return value;

    throw new Error(
      `typeInference.folderMap: "${value}" does not resolve to a known type or alias (from key "${bestKey}")`,
    );
  }

  const leafDir = posix.basename(dir).toLowerCase();

  for (const type of knownTypes) {
    if (type.toLowerCase() === leafDir) return type;
  }

  if (typeAliases) {
    for (const [alias, canonical] of Object.entries(typeAliases)) {
      if (alias.toLowerCase() === leafDir) return canonical;
    }
  }

  return undefined;
}

// js-yaml exports its built-in types at runtime, but @types/js-yaml does not declare them.
const types = (jsYaml as unknown as { types: Record<'merge' | 'binary' | 'omap' | 'pairs' | 'set', Type> }).types;

/**
 * YAML schema for frontmatter and embedded YAML blocks: js-yaml's default schema without the
 * `timestamp` type. Dates and datetimes stay as the strings written (e.g. `2026-03-31`,
 * `2026-06-20T22:53:05+10:00`) rather than becoming Date objects, which lose precision and offset
 * and are not valid JSON.
 */
export const YAML_SCHEMA = CORE_SCHEMA.extend({
  implicit: [types.merge],
  explicit: [types.binary, types.omap, types.pairs, types.set],
});

export function parseYaml(text: string): unknown {
  return load(text, { schema: YAML_SCHEMA });
}

export function dumpYaml(data: unknown, options?: DumpOptions): string {
  return dump(data, { ...options, schema: YAML_SCHEMA });
}

/**
 * gray-matter options using YAML_SCHEMA. Passing options also bypasses gray-matter's parse cache,
 * which is corrupted by a caught parse error (https://github.com/jonschlinkert/gray-matter/issues/166).
 */
export const MATTER_OPTIONS = {
  engines: {
    yaml: { parse: (text: string) => parseYaml(text) as object, stringify: (data: object) => dumpYaml(data) },
  },
};

/**
 * Apply field remapping to a data object.
 * Renames keys according to fieldMap (file field name → canonical field name).
 * Fields not in the map are passed through unchanged.
 */
export function applyFieldMap(
  data: Record<string, unknown>,
  fieldMap: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!fieldMap || Object.keys(fieldMap).length === 0) return data;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[fieldMap[key] ?? key] = value;
  }
  return result;
}

/**
 * Invert a fieldMap (file→canonical) to produce a reverse map (canonical→file).
 * Used for write operations (e.g. template-sync) to translate back to file field names.
 */
export function invertFieldMap(fieldMap: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fieldMap).map(([src, canonical]) => [canonical, src]));
}
