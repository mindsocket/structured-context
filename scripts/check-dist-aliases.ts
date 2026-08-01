/**
 * Post-build guard: fail if compiled dist/ contains unresolved tsconfig
 * path aliases (e.g. '@/plugins/util').
 *
 * tsc emits `@/` imports verbatim — it does not rewrite path aliases.
 * They work under bun's dev runtime but break in the published npm
 * package. This script catches that gap at build time.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = join(import.meta.dir, '..', 'dist');

if (!existsSync(DIST)) {
  console.error('dist/ not found. Run `bun run build` first.');
  process.exit(1);
}

const offenders: string[] = [];
const aliasPattern = /(?:from|import\()\s+['"]@\/[^'"]+['"]/g;

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.endsWith('.js') && !entry.endsWith('.d.ts')) continue;
    const content = readFileSync(fullPath, 'utf-8');
    for (const match of content.matchAll(aliasPattern)) {
      offenders.push(`  ${relative(DIST, fullPath)}: ${match[0]}`);
    }
  }
}

walk(DIST);

if (offenders.length > 0) {
  console.error('\n❌ Unresolved tsconfig path aliases found in dist/:\n');
  for (const o of offenders) console.error(o);
  console.error('\ntsc does not rewrite @/ path aliases. Use relative imports in source files.\n');
  process.exit(1);
}

console.log('✓ No unresolved path aliases in dist/');
