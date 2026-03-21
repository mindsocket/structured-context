import { resolve } from 'node:path';
import { loadConfig, resolveSchema } from '../config';
import type { PluginContext } from '../plugins/util';
import { loadMetadata } from '../schema/schema';

export function loadSpaceContext(path: string, schemaPath?: string): PluginContext {
  const absolutePath = resolve(path);
  const config = loadConfig();
  const space = config.spaces.find((s) => resolve(s.path) === absolutePath);
  const resolvedSchemaPath = resolveSchema(schemaPath, config, space);
  const metadata = loadMetadata(resolvedSchemaPath);
  return { spacePath: absolutePath, space, config, resolvedSchemaPath, metadata, pluginConfig: {} };
}
