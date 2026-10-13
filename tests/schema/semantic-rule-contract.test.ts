import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { loadMetadata } from '../../src/schema/schema';

const dir = join(import.meta.dir, '..', 'fixtures/semantic-rule-contract');
const load = (name: string) => loadMetadata(join(dir, `${name}.json`));

describe('rule contract: check and semantic mode', () => {
  it('requires check on expression rules', () => {
    expect(() => load('no-check')).toThrow();
  });

  it('accepts a semantic rule without check', () => {
    expect(load('semantic-ok').rules).toHaveLength(1);
  });

  it('rejects a semantic rule that also declares check', () => {
    expect(() => load('semantic-check')).toThrow();
  });

  it('rejects a global semantic rule', () => {
    expect(() => load('semantic-global')).toThrow();
  });
});
