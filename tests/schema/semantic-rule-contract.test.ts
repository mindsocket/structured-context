import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMetadata } from '../../src/schema/schema';

const META =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json';
const base = { id: 'r', category: 'validation', description: 'd' };

describe('rule contract: check and semantic mode', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sctx-rule-contract-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const load = (name: string, rule: object) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        $schema: META,
        $id: `sctx://rule-contract.${name}`,
        $metadata: { rules: [rule] },
        type: 'object',
      }),
    );
    return loadMetadata(path);
  };

  it('requires check on expression rules', () => {
    expect(() => load('no-check', base)).toThrow();
  });

  it('accepts a semantic rule without check', () => {
    expect(load('semantic-ok', { ...base, mode: 'semantic' }).rules).toHaveLength(1);
  });

  it('rejects a semantic rule that also declares check', () => {
    expect(() => load('semantic-check', { ...base, mode: 'semantic', check: 'true' })).toThrow();
  });

  it('rejects a global semantic rule', () => {
    expect(() => load('semantic-global', { ...base, mode: 'semantic', scope: 'global' })).toThrow();
  });
});
