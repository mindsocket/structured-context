import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { glob } from 'glob';
import matter from 'gray-matter';
import { extractEmbeddedNodes } from './parse-embedded.js';
import type { OstNode, SpaceReadResult } from './types.js';

export async function readSpace(directory: string): Promise<SpaceReadResult> {
  const files = await glob('**/*.md', { cwd: directory, absolute: false });
  const nodes: OstNode[] = [];
  const skipped: string[] = [];
  const nonOst: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(directory, file), 'utf-8');
    const parsed = matter(content);

    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      skipped.push(file);
      continue;
    }

    if (!parsed.data.type) {
      nonOst.push(file);
      continue;
    }

    const pageType = parsed.data.type as string;
    const fileBase = basename(file, '.md');

    if (pageType === 'ost_on_a_page') {
      // Container page: the file itself is not a node — extract embedded nodes from body.
      const { nodes: embedded } = extractEmbeddedNodes(parsed.content, {
        pageTitle: undefined,
        pageType: 'ost_on_a_page',
        labelPrefix: `${fileBase}#`,
      });
      nodes.push(...embedded);
    } else {
      // Regular OST node page: add the file as a node, then extract any embedded children.
      nodes.push({
        label: file,
        data: { title: fileBase, ...parsed.data },
      });

      const { nodes: embedded } = extractEmbeddedNodes(parsed.content, {
        pageTitle: fileBase,
        pageType,
        labelPrefix: `${fileBase}#`,
      });
      nodes.push(...embedded);
    }
  }

  return { nodes, skipped, nonOst };
}
