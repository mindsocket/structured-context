import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledSchemasDir, loadMetadata } from '../../src/schema/schema';

const META =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json';

const template = {
  id: 'children-distinct',
  abstract: true,
  category: 'coherence',
  description: 'Children are distinct',
  semantic: {
    rubric: 'Judge the children as a set.',
    scope: ['children'],
    verdicts: { distinct: 'All different', overlapping: 'Two overlap' },
    severity: { overlapping: 'warning' },
  },
};

describe('rule templates', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sctx-rule-templates-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const load = (name: string, rules: object[]) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(
      path,
      JSON.stringify({ $schema: META, $id: `sctx://rule-templates.${name}`, $metadata: { rules }, type: 'object' }),
    );
    return loadMetadata(path);
  };

  it('resolves a rule that extends a template, and drops the template', () => {
    const { rules } = load('resolve', [
      template,
      {
        id: 'goals-distinct',
        extends: 'children-distinct',
        description: 'Goals are distinct',
        semantic: { criterion: 'Judge the goals.', severity: { overlapping: 'info' } },
      },
    ]);
    expect(rules as unknown).toEqual([
      {
        id: 'goals-distinct',
        category: 'coherence',
        description: 'Goals are distinct',
        semantic: { ...template.semantic, criterion: 'Judge the goals.', severity: { overlapping: 'info' } },
      },
    ]);
  });

  it('uses one template for several rules', () => {
    const { rules } = load('reuse', [
      template,
      { id: 'a', extends: 'children-distinct' },
      { id: 'b', extends: 'children-distinct', category: 'best-practice' },
    ]);
    expect(rules?.map((rule) => [rule.id, rule.category])).toEqual([
      ['a', 'coherence'],
      ['b', 'best-practice'],
    ]);
  });

  it('fails when the template is unknown or is not abstract', () => {
    expect(() => load('unknown', [{ id: 'a', extends: 'nope' }])).toThrow(
      'Rule "a" extends "nope", but no rule template (a rule with "abstract": true) has that id.',
    );
    const { abstract: _, ...concrete } = template;
    expect(() => load('concrete', [concrete, { id: 'a', extends: 'children-distinct' }])).toThrow('no rule template');
  });

  it('checks the resolved rule as a full rule', () => {
    expect(() => load('invalid', [template, { id: 'a', extends: 'children-distinct', severity: 'warning' }])).toThrow(
      'Rule "a" is not a valid rule once it extends "children-distinct"',
    );
  });

  it('rejects a template that extends another template', () => {
    expect(() => load('nested', [template, { ...template, id: 'b', extends: 'children-distinct' }])).toThrow(
      'Invalid $metadata',
    );
  });

  it('gives bundled rules their template rubric and their own criterion', () => {
    const { rules } = loadMetadata(join(bundledSchemasDir, 'strict_ost.json'));
    const ids = rules?.map((rule) => rule.id) ?? [];
    expect(ids).not.toContain('children-distinct');
    const rule = rules?.find((r) => r.id === 'opportunities-distinct');
    const semantic = rule?.semantic === true ? {} : rule?.semantic;
    expect(semantic?.rubric).toStartWith("Judge the item's children as a set.");
    expect(semantic?.criterion).toStartWith('Judge the child opportunities.');
  });
});
