/**
 * Public API for structured-context.
 *
 * Import from this module to use structured-context as a library:
 *
 *   import { loadConfig, loadSpaceGraph, validateSpace, validateFile } from 'structured-context/api';
 *   import type { StructuredContextPlugin, PluginContext, ParseResult } from 'structured-context/api';
 *
 * Common patterns:
 *
 *   const config = loadConfig();
 *   const graph = await loadSpaceGraph('my-space', config, { filter: 'my-view' });
 *
 *   // Read once, then assemble a graph and validate from the same read and context:
 *   const ctx = createSpaceContext('my-space', config);
 *   const readResult = await readSpace(ctx);
 *   const graph = await assembleSpaceGraph(ctx, { readResult });
 *   const validation = await validateSpace(ctx, { readResult });
 */

export type { AnySchemaObject, SchemaObject, ValidateFunction } from 'ajv';
export type { Config, SpaceConfig } from './config';
export { loadConfig, setConfigPath } from './config';
export { PLUGIN_PREFIX } from './constants';
export { assembleSpaceGraph, loadSpaceGraph } from './load-space-graph';
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
export { readSpace } from './read/read-space';
export type { SharedEmbeddingFields } from './schema/metadata-contract';
export { bundledSchemasDir, loadSchema, setBundledSchemasDir } from './schema/schema';
export { createSpaceContext, SpaceNotFoundError } from './space-context';
export type { SpaceGraph } from './space-graph';
export type {
  BaseNode,
  ContentLink,
  EdgeDefinition,
  FileNotInSpaceResult,
  FileValidationResult,
  HierarchyLevel,
  ParseIssue,
  ReadSpaceResult,
  Relationship,
  ResolvedContentLink,
  SchemaMetadata,
  SchemaWithMetadata,
  SpaceContext,
  SpaceNode,
  UnresolvedRef,
  ValidateFileOutput,
} from './types';
export type { ValidationResult } from './validate';
export { validateFile, validateSpace } from './validate';
