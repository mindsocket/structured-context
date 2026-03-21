import { dirname, join } from 'node:path';
import type { Config, SpaceConfig } from '../../src/config';
import type { PluginContext } from '../../src/plugins/util';
import { bundledSchemasDir, loadMetadata } from '../../src/schema/schema';
import type { SpaceContext } from '../../src/types';

const DEFAULT_SCHEMA = join(bundledSchemasDir, 'general.json');

/** Build a SpaceContext for test fixtures that don't need a real config file. */
export function makeSpaceContext(
  path: string,
  schemaPath?: string,
  plugins?: Record<string, Record<string, unknown>>,
): SpaceContext {
  const resolved = schemaPath ?? DEFAULT_SCHEMA;
  const space: SpaceConfig = { name: 'test', path, plugins };
  const config: Config = { spaces: [space] };
  return {
    space,
    config,
    resolvedSchemaPath: resolved,
    metadata: loadMetadata(resolved),
    configDir: dirname(path),
  };
}

/** Build a PluginContext for testing plugin functions directly. */
export function makePluginContext(path: string, schemaPath?: string): PluginContext {
  return { ...makeSpaceContext(path, schemaPath), pluginConfig: {} };
}
