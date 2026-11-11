import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const srcDir = join(import.meta.dir, '../src');

/**
 * Layers from the bottom up, matching Module Boundaries in docs/architecture.md. A module imports at runtime
 * only from its own layer or lower ones. A file belongs to the longest entry that prefixes its path, so a new
 * file joins its directory's layer and only a new top-level module needs an entry. Contract files that other
 * modules share get their own low entry. Type-only imports are erased at build time, so they are not checked.
 */
const LAYERS: string[][] = [
  ['types', 'constants', 'errors'],
  [
    'space-graph',
    'schema/metadata-contract',
    'schema/rule-severity',
    'schema/schema-refs',
    'schema/meta-schemas',
    'plugins/util',
    'plugins/builtin-names',
    'judge/types',
    'read/wikilink-utils',
  ],
  ['schema/schema', 'judge', 'filter', 'space-graph-data'],
  ['config'],
  ['plugins', 'space-context', 'schema/list-schemas'],
  ['read'],
  ['schema'],
  ['validate', 'load-space-graph'],
  ['render'],
  ['commands', 'api', 'browser', 'testing'],
  ['index'],
];

/** A built-in plugin is reached through the plugin registry, like any other plugin. */
const BUILTIN_PLUGINS = /^plugins\/(markdown|mermaid|miro)\//;

/** Remove each entry when its follow-up fixes it. */
const KNOWN_VIOLATIONS = ['validate -> plugins/markdown/util'];

const entries = LAYERS.flatMap((layer, rank) => layer.map((prefix) => ({ prefix, rank })));

function entryOf(path: string) {
  return entries
    .filter(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''));

const runtimeImports = files.flatMap((file) => {
  const source = readFileSync(join(srcDir, `${file}.ts`), 'utf8');
  return [...source.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+'(\.[^']+)'/gms)]
    .filter((m) => !m[1])
    .map((m) => ({ file, target: relative(srcDir, join(srcDir, dirname(file), m[2]!)).replace(/\.ts$/, '') }));
});

const label = ({ file, target }: { file: string; target: string }) => `${file} -> ${target}`;

describe('module boundaries', () => {
  test('every module has a layer', () => {
    expect(files.filter((f) => !entryOf(f))).toEqual([]);
  });

  test('modules import only from their own layer or lower ones', () => {
    const upward = runtimeImports.filter(({ file, target }) => entryOf(target)!.rank > entryOf(file)!.rank);
    expect(upward.map(label)).toEqual([]);
  });

  test('only the plugin registry imports a built-in plugin', () => {
    const reachIns = runtimeImports.filter(
      (i) => BUILTIN_PLUGINS.test(i.target) && !i.file.startsWith('plugins/') && !KNOWN_VIOLATIONS.includes(label(i)),
    );
    expect(reachIns.map(label)).toEqual([]);
  });

  test('known violations are still present', () => {
    expect(KNOWN_VIOLATIONS.filter((v) => !runtimeImports.map(label).includes(v))).toEqual([]);
  });
});
