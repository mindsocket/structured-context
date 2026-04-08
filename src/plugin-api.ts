/**
 * Public API for external structured-context plugins.
 *
 * Import from this module to get the types needed to implement a StructuredContextPlugin:
 *
 *   import type { StructuredContextPlugin, PluginContext, ParseResult } from 'structured-context/plugin-api';
 */

export type { AnySchemaObject, SchemaObject, ValidateFunction } from 'ajv';
export type {
  ParseHook,
  ParseResult,
  PluginContext,
  RenderFormat,
  RenderHook,
  RenderOptions,
  StructuredContextPlugin,
  TemplateSyncHook,
  TemplateSyncOptions,
} from './plugins/util';
export type { SharedEmbeddingFields } from './schema/metadata-contract';
export type { SpaceGraph } from './space-graph';
export type {
  BaseNode,
  EdgeDefinition,
  HierarchyLevel,
  ParseIssue,
  Relationship,
  SchemaMetadata,
  SchemaWithMetadata,
  SpaceContext,
  SpaceNode,
  UnresolvedRef,
} from './types';
