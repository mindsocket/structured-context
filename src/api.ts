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
export type { Config, ConfigSource, ResolvedConfigPath, SpaceConfig } from './config';
export {
  globalConfigPath,
  loadConfig,
  resolveConfigPath,
  resolveSchema,
  resolveSchemaPath,
  setConfigPath,
} from './config';
export type { ConfigHealth, ConfigProblem } from './config-health';
export { checkConfig, hasBlockingProblem } from './config-health';
export type { AddSpaceOptions, AddSpaceResult } from './config-write';
export { addSpace, chooseWriteTarget } from './config-write';
export { LOCAL_CONFIG_FILE, PLUGIN_PREFIX } from './constants';
export type { SctxErrorCode } from './errors';
export { SctxError } from './errors';
export { assembleSpaceGraph, loadSpaceGraph } from './load-space-graph';
export type {
  ParseHook,
  ParseResult,
  PluginContext,
  RenderFileOutput,
  RenderFormat,
  RenderHook,
  RenderMultiFileOutput,
  RenderOptions,
  RenderResult,
  StructuredContextPlugin,
  TemplateSyncHook,
  TemplateSyncOptions,
} from './plugins/util';
export {
  isRenderMultiFileOutput,
  resolvePluginDir,
  resolvePluginSchemasDir,
  resolveSpacePluginSchemas,
} from './plugins/util';
export { readSpace } from './read/read-space';
export {
  buildTargetIndex,
  formatWikilink,
  type ParsedWikilink,
  parseWikilink,
  wikilinkToTarget,
} from './read/wikilink-utils';
export type { SharedEmbeddingFields } from './schema/metadata-contract';
export { bundledSchemasDir, loadSchema, type PluginSchemaSource, setBundledSchemasDir } from './schema/schema';
export { createSpaceContext, SpaceNotFoundError } from './space-context';
export { buildSpaceGraph, type SpaceGraph } from './space-graph';
export type {
  BaseNode,
  ContentLink,
  EdgeDefinition,
  FileNotInSpaceResult,
  FileValidationIssue,
  FileValidationResult,
  Hierarchy,
  HierarchyLevel,
  ParseIssue,
  ReadSpaceResult,
  Relationship,
  ResolvedContentLink,
  RuleCategory,
  RuleSeverity,
  RuleViolation,
  SchemaMetadata,
  SchemaWithMetadata,
  SourceLocation,
  SpaceContext,
  SpaceNode,
  UnresolvedRef,
  ValidateFileOutput,
} from './types';
export type { ValidationResult } from './validate';
export { validateFile, validateSpace } from './validate';
