import { markdownPlugin } from './markdown';
import type { OstToolsPlugin } from './util';

/** All built-in plugins, in default load order. */
export const builtinPlugins: OstToolsPlugin[] = [markdownPlugin];
