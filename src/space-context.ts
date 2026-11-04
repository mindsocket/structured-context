import { type Config, resolveSchema } from './config';
import { SctxError } from './errors';
import { resolveSpacePluginSchemas } from './plugins/util';
import { loadSchema } from './schema/schema';
import type { SpaceContext } from './types';

export interface CreateSpaceContextOptions {
  /**
   * Directory to anchor relative plugin-config paths against. Defaults to the source
   * directory recorded by loadConfig (space.sourceDir). Required for a hand-assembled
   * Config, which has no source file — pass e.g. process.cwd(), or the directory the
   * paths are relative to.
   */
  configDir?: string;
}

/**
 * Build a SpaceContext for a named space from an already-loaded config.
 *
 * Synchronously resolves schemas (including plugin-contributed schemas),
 * indexes partials into the registry, and compiles the schema validator.
 *
 * Library-safe: throws SctxError (E_SPACE_NOT_FOUND) on an unknown space rather than
 * writing to the console or exiting the process.
 */
export function createSpaceContext(
  spaceName: string,
  config: Config,
  options: CreateSpaceContextOptions = {},
): SpaceContext {
  const space = config.spaces.find((s) => s.name === spaceName);
  if (!space) {
    throw new SctxError('E_SPACE_NOT_FOUND', `Unknown space "${spaceName}"`);
  }
  const configDir = options.configDir ?? space.sourceDir;
  if (configDir === undefined) {
    throw new Error(
      `Cannot resolve a config directory for space "${spaceName}": its Config was not loaded from a ` +
        `file. Pass options.configDir (e.g. process.cwd()) to anchor relative plugin paths, or load ` +
        `the config with loadConfig().`,
    );
  }

  const resolvedSchemaPath = resolveSchema(config, space, { configDir });
  const pluginSchemas = resolveSpacePluginSchemas(space, config, configDir);
  let loaded: ReturnType<typeof loadSchema>;
  try {
    loaded = loadSchema(resolvedSchemaPath, pluginSchemas);
  } catch (err) {
    if (err instanceof SctxError) throw err;
    throw new SctxError(
      'E_SCHEMA_INVALID',
      `Space "${spaceName}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { schema, schemaRefRegistry, schemaValidator } = loaded;

  return {
    space,
    config,
    resolvedSchemaPath,
    schema,
    schemaRefRegistry,
    schemaValidator,
    configDir,
  };
}
