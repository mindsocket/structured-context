import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMetadata } from '../../src/schema/schema';

const META =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json';
const base = { id: 'r', category: 'validation', description: 'd' };

describe('rule contract: expression and semantic', () => {
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

  it('requires an expression or a semantic part', () => {
    expect(() => load('neither', base)).toThrow();
  });

  it('accepts `semantic: {}` and `semantic: true` as the all-defaults form', () => {
    expect(load('semantic-ok', { ...base, semantic: {} }).rules).toHaveLength(1);
    expect(load('semantic-true', { ...base, semantic: true }).rules).toHaveLength(1);
    expect(() => load('semantic-false', { ...base, semantic: false })).toThrow();
  });

  it('accepts a rule with both an expression and a semantic part', () => {
    expect(load('both', { ...base, semantic: {}, expression: 'true' }).rules).toHaveLength(1);
  });

  it('rejects unknown rule fields', () => {
    expect(() => load('unknown-field', { ...base, expression: 'true', scope: 'global' })).toThrow();
  });

  it('rejects a global semantic rule, and `when` or `type` on a global rule', () => {
    expect(() => load('semantic-global', { ...base, semantic: {}, global: true })).toThrow();
    expect(() => load('both-global', { ...base, semantic: {}, expression: 'true', global: true })).toThrow();
    expect(() => load('global-when', { ...base, expression: 'true', global: true, when: 'true' })).toThrow();
    expect(() => load('global-type', { ...base, expression: 'true', global: true, type: 'goal' })).toThrow();
    expect(load('global-ok', { ...base, expression: 'true', global: true }).rules).toHaveLength(1);
    expect(load('global-false', { ...base, expression: 'true', global: false, type: 'x' }).rules).toHaveLength(1);
  });

  it('accepts a verdict map with guidance, a severity map (including ignore) and a when', () => {
    const rule = {
      ...base,
      when: "current.status = 'ready'",
      semantic: {
        rubric: 'Is it specific?',
        verdicts: { ok: 'Fine', vague: { description: 'Too vague', guidance: 'Be specific.' } },
        severity: { vague: 'warning' },
      },
    };
    expect(load('shape-ok', rule).rules).toHaveLength(1);
    expect(
      load('ignore-ok', { ...rule, semantic: { ...rule.semantic, severity: { vague: 'ignore' } } }).rules,
    ).toHaveLength(1);
  });

  it('requires a severity map when custom verdicts are declared', () => {
    const verdicts = { ok: 'Fine', bad: 'Bad' };
    expect(() => load('verdicts-no-severity', { ...base, semantic: { verdicts } })).toThrow();
    expect(() => load('verdicts-scalar', { ...base, semantic: { verdicts, severity: 'error' } })).toThrow();
  });

  it('takes a verdict map alongside default verdicts only for verdicts other than `fail`', () => {
    expect(load('reserved-ok', { ...base, semantic: { severity: { 'missing-context': 'info' } } }).rules).toHaveLength(
      1,
    );
    expect(() => load('fail-in-map', { ...base, semantic: { severity: { fail: 'error' } } })).toThrow();
    expect(load('semantic-true-severity', { ...base, semantic: true, severity: 'error' }).rules).toHaveLength(1);
  });

  it('rejects a top-level severity on a semantic-only rule with custom verdicts', () => {
    const semantic = { verdicts: { ok: 'Fine', bad: 'Bad' }, severity: { bad: 'error' } };
    expect(() => load('custom-top-severity', { ...base, semantic, severity: 'error' })).toThrow();
    expect(
      load('custom-with-expression', { ...base, semantic, expression: 'true', severity: 'error' }).rules,
    ).toHaveLength(1);
  });

  it('keeps a verdict map off the top-level severity and rules choose no provider', () => {
    const expr = { ...base, expression: 'true' };
    expect(() => load('expr-map', { ...expr, severity: { fail: 'error' } })).toThrow();
    expect(() => load('expr-provider', { ...expr, provider: 'llm' })).toThrow();
    expect(() => load('semantic-provider', { ...base, semantic: { provider: 'llm' } })).toThrow();
    expect(() => load('expr-verdicts', { ...expr, verdicts: { a: 'A', b: 'B' } })).toThrow();
    expect(load('expr-when', { ...expr, when: 'true' }).rules).toHaveLength(1);
  });
});
