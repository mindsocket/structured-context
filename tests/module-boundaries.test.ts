import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const srcDir = join(import.meta.dir, '../src');

/**
 * The layers in Module Boundaries in docs/architecture.md, from the bottom up. A file belongs to the longest
 * entry that prefixes its path, so a new file joins its directory's layer.
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
  ['index', 'commands', 'api', 'browser', 'testing'],
];

/** Remove each entry when its fix lands. */
const KNOWN_VIOLATIONS = ['validate -> plugins/markdown/util'];

const entries = LAYERS.flatMap((layer, rank) => layer.map((prefix) => ({ prefix, rank })));

function entryOf(path: string) {
  return entries
    .filter(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

const builtinPlugins = readdirSync(join(srcDir, 'plugins'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => `plugins/${d.name}`);

const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''));

// The transpiler drops type-only imports, which are erased at build time, and keeps dynamic imports.
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const runtimeImports = files.flatMap((file) =>
  transpiler
    .scanImports(readFileSync(join(srcDir, `${file}.ts`), 'utf8').replace(/^#!.*/, ''))
    .filter(({ path }) => path.startsWith('.'))
    .map(({ path }) => ({ file, target: relative(srcDir, join(srcDir, dirname(file), path)).replace(/\.ts$/, '') }))
    .filter(({ target }) => !target.startsWith('..')),
);

const label = ({ file, target }: { file: string; target: string }) => `${file} -> ${target}`;

describe('module boundaries', () => {
  test('every module has a layer', () => {
    expect(files.filter((f) => !entryOf(f))).toEqual([]);
  });

  test('imports point down', () => {
    const upward = runtimeImports.filter(({ file, target }) => entryOf(target)!.rank > entryOf(file)!.rank);
    expect(upward.map(label)).toEqual([]);
  });

  test('only the plugin registry reaches a built-in plugin', () => {
    const reachIns = runtimeImports.filter(
      (i) =>
        builtinPlugins.some((p) => i.target === p || i.target.startsWith(`${p}/`)) &&
        !i.file.startsWith('plugins/') &&
        !KNOWN_VIOLATIONS.includes(label(i)),
    );
    expect(reachIns.map(label)).toEqual([]);
  });

  test('known violations are still present', () => {
    const labels = runtimeImports.map(label);
    expect(KNOWN_VIOLATIONS.filter((v) => !labels.includes(v))).toEqual([]);
  });
});
