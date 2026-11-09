import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

// Built once: a frozen processor parses any number of documents.
const processor = unified().use(remarkParse).use(remarkGfm).freeze();

/** Parse markdown (with GFM) into an mdast tree. */
export function parseMarkdown(markdown: string): Root {
  return processor.parse(markdown);
}
