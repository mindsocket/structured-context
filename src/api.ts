/**
 * Public API for structured-context.
 *
 * Import from this module to use structured-context as a library:
 *
 *   import { validateFile } from 'structured-context/api';
 *   import type { StructuredContextPlugin, PluginContext, ParseResult } from 'structured-context/api';
 */

export type { AnySchemaObject, SchemaObject, ValidateFunction } from 'ajv';
export type { Config, SpaceConfig } from './config';
export { loadConfig, setConfigPath } from './config';
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
export { bundledSchemasDir, loadSchema, setBundledSchemasDir } from './schema/schema';
export type { SpaceGraph } from './space-graph';
export type {
  BaseNode,
  ContentLink,
  EdgeDefinition,
  FileNotInSpaceResult,
  FileValidationResult,
  HierarchyLevel,
  ParseIssue,
  Relationship,
  ResolvedContentLink,
  SchemaMetadata,
  SchemaWithMetadata,
  SpaceContext,
  SpaceNode,
  UnresolvedRef,
  ValidateFileOutput,
} from './types';
export { validateFile } from './validate';
