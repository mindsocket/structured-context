import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const srcDir = join(import.meta.dir, '../src');

type Import = { file: string; target: string; typeOnly: boolean };

/** Relative imports in `src/`, with each target as a `src`-relative path without extension. */
const imports: Import[] = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .flatMap((file) => {
    const source = readFileSync(join(srcDir, file), 'utf8');
    return [...source.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+'(\.[^']+)'/gms)].map((m) => ({
      file,
      target: relative(srcDir, join(srcDir, dirname(file), m[2]!)).replace(/\.ts$/, ''),
      typeOnly: Boolean(m[1]),
    }));
  });

const under = (path: string, ...areas: string[]) => areas.some((area) => path === area || path.startsWith(`${area}/`));

/** Imports from files in `from` that reach any of `to`. */
const importsBetween = (from: string[], to: string[]) =>
  imports.filter(({ file, target }) => under(file.replace(/\.ts$/, ''), ...from) && under(target, ...to));

describe('module boundaries', () => {
  test('only the CLI entry point imports commands', () => {
    expect(
      imports.filter(({ file, target }) => under(target, 'commands') && !/^(index|commands\/)/.test(file)),
    ).toEqual([]);
  });

  test('the library does not import the run or the CLI', () => {
    expect(importsBetween(['schema', 'judge', 'read', 'plugins'], ['validate', 'commands'])).toEqual([]);
  });

  test('the judge does not import rule evaluation, reading or plugins', () => {
    const evaluation = ['schema/gating', 'schema/validate-rules', 'schema/evaluate-rule', 'schema/validate-graph'];
    expect(importsBetween(['judge'], [...evaluation, 'read', 'plugins'])).toEqual([]);
  });

  test('validate builds the judge but leaves its input to rule evaluation', () => {
    expect(importsBetween(['validate'], ['judge']).filter((i) => !i.typeOnly && i.target !== 'judge/factory')).toEqual(
      [],
    );
  });
});
