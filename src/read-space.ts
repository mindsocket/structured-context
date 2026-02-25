import { glob } from 'glob';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import matter from 'gray-matter';
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

    nodes.push({
      label: file,
      data: { title: basename(file, '.md'), ...parsed.data },
    });
  }

  return { nodes, skipped, nonOst };
}
