import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { type Config, loadConfig, resolveConfigPath, resolveSchemaPath } from '../config';
import { PLUGIN_PREFIX } from '../constants';
import {
  CONFIG_PLUGINS_DIR,
  resolvePluginSchemasDir,
  resolveSpacePluginSchemas,
  shortenPluginName,
} from '../plugins/util';
import { bundledSchemasDir, readRawSchema } from './schema';

/** A schema available to a space: bundled, contributed by a plugin, or referenced by a config. */
export type SchemaListing = {
  /**
   * The value for a config's `schema` field: the file name for a bundled schema, `<plugin>/<file>` for a plugin
   * schema, otherwise what the config gives (a relative path is already absolute once the config is loaded).
   */
  file: string;
  /** Absolute location, or the URL of a remote schema. Omitted for bundled schemas. */
  path?: string;
  /** Where the file lives: `core`, a plugin's short name, or `configured` for any other file. */
  source: string;
  /** Spaces that use this schema, with `global` for the top-level `schema`. */
  usedBy: string[];
  /** A fragment for `$ref` (file name starts with `_`), not a schema for a space to use directly. */
  partial: boolean;
  id?: string;
  title?: string;
  description?: string;
  /** Why the schema could not be read. The listing carries on without it. */
  error?: string;
};

export type ListSchemasOptions = {
  /** The config to list schemas for. Loaded by discovery when omitted. */
  config?: Config;
  /** Where config discovery starts when `config` is omitted. */
  startDir?: string;
};

function isRemote(ref: string): boolean {
  return /^https?:\/\//.test(ref);
}

function describeSchema(path: string): Pick<SchemaListing, 'id' | 'title' | 'description' | 'error'> {
  try {
    const schema = readRawSchema(path);
    return {
      ...(typeof schema.$id === 'string' && { id: schema.$id }),
      ...(typeof schema.title === 'string' && { title: schema.title }),
      ...(typeof schema.description === 'string' && { description: schema.description }),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function jsonFiles(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

/**
 * List the schemas available to the config: bundled schemas, schemas contributed by plugins, and any other
 * schema file the config points at. Each schema appears once, under the place its file lives.
 */
export async function listSchemas(options: ListSchemasOptions = {}): Promise<SchemaListing[]> {
  const config = options.config ?? loadConfig({ startDir: options.startDir });
  const listings: SchemaListing[] = [];
  const byPath = new Map<string, SchemaListing>();

  const add = (listing: SchemaListing, location: string) => {
    listings.push(listing);
    byPath.set(resolve(location), listing);
  };

  for (const file of jsonFiles(bundledSchemasDir)) {
    const location = join(bundledSchemasDir, file);
    add({ file, source: 'core', usedBy: [], partial: file.startsWith('_'), ...describeSchema(location) }, location);
  }

  // Relative schema references are anchored at the folder of the config that holds them
  const fallbackDir = dirname(resolveConfigPath(options.startDir).path);
  const configDirs = [...new Set([fallbackDir, ...config.spaces.map((s) => s.sourceDir ?? fallbackDir)])];

  // Plugins are found the way schema references resolve them, without loading their code: those declared by a
  // space or the config, and any installed beside a config file
  const pluginSchemaDirs = new Map<string, string>();
  for (const space of [undefined, ...config.spaces]) {
    for (const { pluginName, schemasDir } of resolveSpacePluginSchemas(
      space,
      config,
      space?.sourceDir ?? fallbackDir,
    )) {
      pluginSchemaDirs.set(pluginName, schemasDir);
    }
  }
  for (const dir of configDirs) {
    const pluginsDir = join(dir, CONFIG_PLUGINS_DIR);
    if (!existsSync(pluginsDir)) continue;
    for (const entry of readdirSync(pluginsDir).filter((e) => e.startsWith(PLUGIN_PREFIX))) {
      const schemasDir = resolvePluginSchemasDir(entry, dir);
      if (schemasDir && !pluginSchemaDirs.has(shortenPluginName(entry))) {
        pluginSchemaDirs.set(shortenPluginName(entry), schemasDir);
      }
    }
  }
  for (const [source, schemasDir] of pluginSchemaDirs) {
    for (const file of jsonFiles(schemasDir)) {
      const location = join(schemasDir, file);
      add(
        {
          file: `${source}/${file}`,
          path: location,
          source,
          usedBy: [],
          partial: file.startsWith('_'),
          ...describeSchema(location),
        },
        location,
      );
    }
  }

  const references = [
    ...(config.schema ? [{ user: 'global', raw: config.schema, dir: fallbackDir }] : []),
    ...config.spaces.flatMap((s) =>
      s.schema ? [{ user: s.name, raw: s.schema, dir: s.sourceDir ?? fallbackDir }] : [],
    ),
  ];

  for (const { user, raw, dir } of references) {
    const location = isRemote(raw) ? raw : resolveSchemaPath(raw, dir);
    const key = isRemote(raw) ? raw : resolve(location);
    let listing = byPath.get(key);
    if (!listing) {
      listing = {
        file: raw,
        path: isRemote(raw) || isAbsolute(location) ? location : resolve(location),
        source: 'configured',
        usedBy: [],
        partial: basename(raw).startsWith('_'),
        ...(isRemote(raw)
          ? { error: 'Remote schemas are not read' }
          : existsSync(location)
            ? describeSchema(location)
            : { error: `Schema file not found: ${location}` }),
      };
      add(listing, key);
    }
    if (!listing.usedBy.includes(user)) listing.usedBy.push(user);
  }

  return listings;
}
