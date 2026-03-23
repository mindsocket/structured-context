/**
 * Public API for external ost-tools plugins.
 *
 * Import from this module to get the types needed to implement an OstToolsPlugin:
 *
 *   import type { OstToolsPlugin, PluginContext, ParseResult } from 'ost-tools/plugin-api';
 */

export type { AnySchemaObject, SchemaObject } from 'ajv';
export type {
  OstToolsPlugin,
  ParseHook,
  ParseResult,
  PluginContext,
  TemplateSyncHook,
  TemplateSyncOptions,
} from './plugins/util';
export type { SharedEmbeddingFields } from './schema/metadata-contract';
export type {
  BaseNode,
  EdgeDefinition,
  HierarchyLevel,
  Relationship,
  SchemaMetadata,
  SchemaWithMetadata,
  SpaceContext,
  SpaceNode,
  UnresolvedRef,
} from './types';
