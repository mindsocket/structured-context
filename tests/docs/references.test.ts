import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Guards against path rot in the docs and skills that point readers at files in this repo.
 * A stale path sends the reader somewhere that no longer exists.
 *
 * This checks that a path resolves, not that the claim around it is true.
 * Historical records (docs/plans) are out of scope: they cite paths that have since moved.
 */

const ROOT = resolve(import.meta.dir, '../..');

/** Docs that describe the current tree: agent instructions, README, top-level docs, and plugin skills. */
const SCANNED = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs', 'plugin'];

/** Repo-relative paths appear in backticks; these are the roots worth checking. */
const PATH_PATTERN = /`\/?((?:src|tests|schemas|plugin|docs|scripts|hook-test|smoke)\/[^`\s]*)`/g;

/** Illustrative paths, not real ones: placeholders, globs, and naming-convention examples. */
const PLACEHOLDER = /YYYY|<[^>]+>|\[[^\]]+\]|\*|PascalCase|kebab-case|\bNN\b|\.\.\./;

/** A line that gives an example or aside. Paths on these lines are illustrative, not promises. */
const EXAMPLE_LINE = /\b(e\.g\.?|eg|i\.e\.?|example|examples|for instance)\b/i;

function markdownFilesUnder(relPath: string): string[] {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return relPath.endsWith('.md') ? [relPath] : [];
  return readdirSync(abs)
    .filter((entry) => entry !== 'node_modules')
    .flatMap((entry) => markdownFilesUnder(join(relPath, entry)));
}

const docs = SCANNED.flatMap(markdownFilesUnder).filter((doc) => !doc.startsWith('docs/plans/'));

/** Gitignored paths (generated DBs, build output) never exist in a fresh checkout. */
function isGitignored(relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', relPath], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

describe('documentation file references', () => {
  it('scans the docs an agent is pointed at', () => {
    expect(docs).toContain('AGENTS.md');
    expect(docs).toContain('docs/concepts.md');
    expect(docs.some((doc) => doc.startsWith('plugin/'))).toBe(true);
  });

  it.each(docs)('%s references only paths that exist', (doc) => {
    const broken: string[] = [];

    for (const line of readFileSync(join(ROOT, doc), 'utf-8').split('\n')) {
      if (EXAMPLE_LINE.test(line)) continue;
      for (const match of line.matchAll(PATH_PATTERN)) {
        // Trim `file.ts:12, 30` line citations and any trailing prose punctuation.
        const path = (match[1] ?? '').replace(/:[\d,\s–-]+$/, '').replace(/[.,;)]+$/, '');
        if (PLACEHOLDER.test(path)) continue;
        if (isGitignored(path)) continue;
        if (!existsSync(join(ROOT, path))) broken.push(path);
      }
    }

    expect(broken, `${doc} references paths that no longer exist`).toEqual([]);
  });
});
