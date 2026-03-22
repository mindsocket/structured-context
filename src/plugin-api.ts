/**
 * Public API for external ost-tools plugins.
 *
 * Import from this module to get the types needed to implement an OstToolsPlugin:
 *
 *   import type { OstToolsPlugin, PluginContext, ParseResult } from 'ost-tools/plugin-api';
 */

export type {
  OstToolsPlugin,
  ParseHook,
  ParseResult,
  PluginContext,
  TemplateSyncHook,
  TemplateSyncOptions,
} from './plugins/util';
export { resolveNodeType } from './schema/schema';
export type {
  EdgeDefinition,
  HierarchyLevel,
  Relationship,
  SchemaMetadata,
  SpaceContext,
  SpaceNode,
  UnresolvedRef,
} from './types';
