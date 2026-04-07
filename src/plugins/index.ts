import { markdownPlugin } from './markdown';
import type { StructuredContextPlugin } from './util';

/** All built-in plugins, in default load order. */
export const builtinPlugins: StructuredContextPlugin[] = [markdownPlugin];
