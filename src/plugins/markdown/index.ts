import { statSync } from 'node:fs';
import type { FromSchema } from 'json-schema-to-ts';
import type { ParseResult, PluginContext, StructuredContextPlugin } from '../util';
import { PLUGIN_PREFIX } from '../util';
import { readSpaceDirectory, readSpaceOnAPage } from './read-space';
import { renderBullets } from './render-bullets';
import { templateSync } from './template-sync';

const TYPE_INFERENCE_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['folder-name', 'off'] },
    folderMap: { type: 'object', additionalProperties: { type: 'string' } },
  },
  additionalProperties: false,
} as const;
export const MARKDOWN_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    templateDir: { type: 'string', format: 'path' }, // format is hint to config loader to resolve relative directories
    fieldMap: { type: 'object', additionalProperties: { type: 'string' } },
    templatePrefix: { type: 'string' },
    typeInference: TYPE_INFERENCE_CONFIG_SCHEMA,
  },
  additionalProperties: false,
} as const;

export type MarkdownPluginConfig = FromSchema<typeof MARKDOWN_CONFIG_SCHEMA>;
export type TypeInferenceConfig = FromSchema<typeof TYPE_INFERENCE_CONFIG_SCHEMA>;

export function getMarkdownConfig(plugins?: Record<string, Record<string, unknown>>): MarkdownPluginConfig {
  return (plugins?.[`${PLUGIN_PREFIX}markdown`] ?? {}) as MarkdownPluginConfig;
}

async function parse(context: PluginContext): Promise<ParseResult | null> {
  if (statSync(context.space.path).isFile()) {
    return readSpaceOnAPage(context);
  }
  return await readSpaceDirectory(context);
}

export const markdownPlugin: StructuredContextPlugin = {
  name: `${PLUGIN_PREFIX}markdown`,
  configSchema: MARKDOWN_CONFIG_SCHEMA,
  parse,
  templateSync,
  render: {
    formats: [{ name: 'bullets', description: 'Indented bullet list' }],
    render(_context, graph, { format }) {
      if (format === 'bullets') return renderBullets(graph);
      throw new Error(`Unknown markdown render format: "${format}"`);
    },
  },
};
