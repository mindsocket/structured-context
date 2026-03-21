import { statSync } from 'node:fs';
import type { OstToolsPlugin, ParseResult, PluginContext } from '../util';
import { PLUGIN_PREFIX } from '../util';
import { readSpaceDirectory, readSpaceOnAPage } from './read-space';

export type MarkdownPluginConfig = {
  templateDir?: string;
  fieldMap?: Record<string, string>;
  templatePrefix?: string;
};

export const MARKDOWN_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    templateDir: { type: 'string', format: 'path' }, // format is hint to config loader to resolve relative directories
    fieldMap: { type: 'object', additionalProperties: { type: 'string' } },
    templatePrefix: { type: 'string' },
  },
  additionalProperties: false,
};

async function parse(context: PluginContext): Promise<ParseResult | null> {
  if (statSync(context.spacePath).isFile()) {
    return readSpaceOnAPage(context);
  }
  return await readSpaceDirectory(context);
}

export const markdownPlugin: OstToolsPlugin = {
  name: `${PLUGIN_PREFIX}markdown`,
  configSchema: MARKDOWN_CONFIG_SCHEMA,
  parse,
};
