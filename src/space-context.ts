import { type Config, resolveSchema } from './config';
import { loadSchema } from './schema/schema';
import type { SpaceContext } from './types';

/** Thrown by createSpaceContext when no space matches the given name. */
export class SpaceNotFoundError extends Error {
  constructor(public readonly spaceName: string) {
    super(`Unknown space "${spaceName}"`);
    this.name = 'SpaceNotFoundError';
  }
}

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
 * Library-safe: throws {@link SpaceNotFoundError} on an unknown space rather than
 * writing to the console or exiting the process. CLI callers that want the
 * exit-on-error behaviour should wrap this (see buildSpaceContext in index.ts).
 */
export function createSpaceContext(
  spaceName: string,
  config: Config,
  options: CreateSpaceContextOptions = {},
): SpaceContext {
  const space = config.spaces.find((s) => s.name === spaceName);
  if (!space) {
    throw new SpaceNotFoundError(spaceName);
  }
  const configDir = options.configDir ?? space.sourceDir;
  if (configDir === undefined) {
    throw new Error(
      `Cannot resolve a config directory for space "${spaceName}": its Config was not loaded from a ` +
        `file. Pass options.configDir (e.g. process.cwd()) to anchor relative plugin paths, or load ` +
        `the config with loadConfig().`,
    );
  }
  const resolvedSchemaPath = resolveSchema(config, space);
  const { schema, schemaRefRegistry, schemaValidator } = loadSchema(resolvedSchemaPath);
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
