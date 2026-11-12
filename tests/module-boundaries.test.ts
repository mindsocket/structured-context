import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const srcDir = join(import.meta.dir, '../src');

/** The layers in Module Boundaries in docs/architecture.md, from the bottom up, by top-level module. */
const LAYERS: string[][] = [
  ['types', 'constants', 'errors'],
  ['schema', 'config', 'space-context', 'space-graph', 'space-graph-data'],
  ['filter', 'judge', 'rule', 'plugins'],
  ['read', 'render', 'validate', 'load-space-graph'],
  ['index', 'commands', 'api', 'browser'],
];

/**
 * Imports that break a rule today, each with the change that would remove it.
 * The test fails when an entry no longer applies, so remove it with its fix.
 */
const EXCEPTIONS: Record<string, string> = {
  'config/index -> judge/types': 'the model provider APIs move to a concept the judge and config share',
  'config/index -> plugins/util': 'plugin name and path helpers move out of plugins/',
  'schema/schema -> plugins/util': 'plugin name and path helpers move out of plugins/',
  'schema/list-schemas -> plugins/util': 'plugin name and path helpers move out of plugins/',
  'space-context -> plugins/util': 'plugin name and path helpers move out of plugins/',
  'plugins/markdown/extract-content-links -> read/wikilink-utils':
    'wikilink helpers move to a concept that read/ and plugins share',
};

const rank = (path: string) => LAYERS.findIndex((layer) => layer.includes(path.split('/')[0]!));

const builtinPlugins = readdirSync(join(srcDir, 'plugins'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => `plugins/${d.name}`);

const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''));

// The transpiler drops type-only imports, which are erased at build time, and keeps dynamic imports.
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const imports = files.flatMap((file) =>
  transpiler
    .scanImports(readFileSync(join(srcDir, `${file}.ts`), 'utf8').replace(/^#!.*/, ''))
    .filter(({ path }) => path.startsWith('.'))
    .map(({ path }) => {
      const target = relative(srcDir, join(srcDir, dirname(file), path)).replace(/\.ts$/, '');
      return { file, target, label: `${file} -> ${target}` };
    })
    .filter(({ target }) => !target.startsWith('..')),
);
const unexcepted = imports.filter(({ label }) => !(label in EXCEPTIONS));

describe('module boundaries', () => {
  test('every top-level module has a layer', () => {
    expect(files.filter((f) => rank(f) < 0)).toEqual([]);
  });

  test('imports stay in their layer or point down', () => {
    expect(unexcepted.filter(({ file, target }) => rank(target) > rank(file)).map((i) => i.label)).toEqual([]);
  });

  test('only plugins/ reaches into a built-in plugin', () => {
    const reachIns = unexcepted.filter(
      ({ file, target }) =>
        !file.startsWith('plugins/') && builtinPlugins.some((p) => target === p || target.startsWith(`${p}/`)),
    );
    expect(reachIns.map((i) => i.label)).toEqual([]);
  });

  test('every exception still applies', () => {
    const labels = new Set(imports.map((i) => i.label));
    expect(Object.keys(EXCEPTIONS).filter((e) => !labels.has(e))).toEqual([]);
  });
});
