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

  it('accepts a verdict map with guidance, a severity map (including ignore), a judge and a when', () => {
    const rule = {
      ...base,
      mode: 'semantic',
      judge: 'llm',
      when: "current.status = 'ready'",
      verdicts: { ok: 'Fine', vague: { description: 'Too vague', guidance: 'Be specific.' } },
      severity: { vague: 'warning' },
    };
    expect(load('shape-ok', rule).rules).toHaveLength(1);
    expect(load('ignore-ok', { ...rule, severity: { vague: 'ignore' } }).rules).toHaveLength(1);
  });

  it('requires a severity map when custom verdicts are declared', () => {
    const verdicts = { ok: 'Fine', bad: 'Bad' };
    expect(() => load('verdicts-no-severity', { ...base, mode: 'semantic', verdicts })).toThrow();
    expect(() => load('verdicts-scalar', { ...base, mode: 'semantic', verdicts, severity: 'error' })).toThrow();
  });

  it('keeps semantic-only fields off expression rules', () => {
    const expr = { ...base, check: 'true' };
    expect(() => load('expr-map', { ...expr, severity: { fail: 'error' } })).toThrow();
    expect(() => load('expr-judge', { ...expr, judge: 'llm' })).toThrow();
    expect(() => load('expr-verdicts', { ...expr, verdicts: { a: 'A', b: 'B' } })).toThrow();
    expect(load('expr-when', { ...expr, when: 'true' }).rules).toHaveLength(1);
  });

  it('rejects `when` on a global rule', () => {
    expect(() => load('global-when', { ...base, check: 'true', scope: 'global', when: 'true' })).toThrow();
  });
});
