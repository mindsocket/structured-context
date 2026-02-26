import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import matter from 'gray-matter';
import { extractEmbeddedNodes } from './parse-embedded.js';
import type { OstNode, OstPageReadResult } from './types.js';

export function readOstPage(filePath: string): OstPageReadResult {
  const raw = readFileSync(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(raw);

  const pageType = frontmatter.type as string | undefined;
  const isHybrid = pageType !== undefined && pageType !== 'ost_on_a_page';

  if (isHybrid) {
    // Hybrid file: the page itself is an OST node, plus it may contain embedded children.
    const pageTitle = basename(filePath, '.md');

    const fileNode: OstNode = {
      label: basename(filePath),
      data: { title: pageTitle, ...frontmatter },
    };

    const { nodes: embeddedNodes, diagnostics } = extractEmbeddedNodes(body, {
      pageTitle,
      pageType,
    });

    return {
      nodes: [fileNode, ...embeddedNodes],
      diagnostics,
    };
  }

  // Classic ost_on_a_page (or no type): entire body is the OST structure.
  const { nodes, diagnostics } = extractEmbeddedNodes(body, {
    pageTitle: undefined,
    pageType: undefined,
  });

  return { nodes, diagnostics };
}
