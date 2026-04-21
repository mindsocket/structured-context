import { dirname, join } from 'node:path';
import type { Config, SpaceConfig } from '../../src/config';
import type { PluginContext } from '../../src/plugins/util';
import { bundledSchemasDir, loadSchema } from '../../src/schema/schema';
import type { SpaceContext } from '../../src/types';

const DEFAULT_SCHEMA = join(bundledSchemasDir, 'strategy_general.json');

/** Build a SpaceContext for test fixtures that don't need a real config file. */
export function makeSpaceContext(
  path: string,
  schemaPath?: string,
  plugins?: Record<string, Record<string, unknown>>,
): SpaceContext {
  const resolved = schemaPath ?? DEFAULT_SCHEMA;
  const space: SpaceConfig = { name: 'test', path, plugins };
  const config: Config = { spaces: [space] };
  const { schema, schemaRefRegistry, schemaValidator } = loadSchema(resolved);
  return {
    space,
    config,
    resolvedSchemaPath: resolved,
    schema,
    schemaRefRegistry,
    schemaValidator,
    configDir: dirname(path),
  };
}

/** Build a PluginContext for testing plugin functions directly. */
export function makePluginContext(
  path: string,
  schemaPath?: string,
  pluginConfig: Record<string, unknown> = {},
): PluginContext {
  return {
    ...makeSpaceContext(path, schemaPath),
    pluginConfig,
    callbacks: {
      persistConfig: () => {
        // no-op in tests
      },
    },
  };
}
