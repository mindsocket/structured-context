import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { bundledSchemasDir, createValidator, loadMetadata } from '../../src/schema/schema';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures/schema-composition');
const MULTI_DIR = join(import.meta.dir, '..', 'fixtures/multi-hierarchy');

describe('schema composition metadata', () => {
  it('merges metadata across $ref graph in DFS order and applies root metadata last', () => {
    const metadata = loadMetadata(join(FIXTURES_DIR, 'merge-root.json'));

    expect(metadata.hierarchy?.levels.map((level) => level.type)).toEqual(['vision', 'goal']);
    expect(metadata.typeAliases).toEqual({
      north_star: 'vision',
      outcome: 'goal',
      goal: 'objective',
    });
    expect(metadata.rules?.map((rule) => rule.id)).toEqual(['leaf-rule', 'pack-a-rule', 'root-rule']);
  });

  it('fails when a type belongs to two hierarchies', () => {
    // Root declares ["goal"]; the partial it composes declares ["vision", "goal"].
    expect(() => loadMetadata(join(FIXTURES_DIR, 'hierarchy-conflict-root.json'))).toThrow(
      'Type "goal" belongs to both hierarchy "_hierarchy-conflict-pack" and hierarchy "hierarchy-conflict-root"',
    );
  });

  it('fails conflicting rule IDs without explicit override', () => {
    expect(() => loadMetadata(join(FIXTURES_DIR, 'conflict-root.json'))).toThrow(
      'Conflicting rule "active-outcome-count"',
    );
  });

  it('allows later rule override when override=true', () => {
    const metadata = loadMetadata(join(FIXTURES_DIR, 'override-root.json'));

    expect(metadata.rules).toHaveLength(1);
    expect(metadata.rules?.[0]).toMatchObject({
      id: 'active-outcome-count',
      check: "$count(nodes[resolvedType='outcome' and status='active']) = 1",
    });
    expect((metadata.rules?.[0] as Record<string, unknown>).override).toBeUndefined();
  });

  it('imports specific rules and rule sets via $ref targets', () => {
    const metadata = loadMetadata(join(FIXTURES_DIR, 'rule-import-root.json'));

    expect(metadata.rules?.map((rule) => rule.id)).toEqual([
      'workflow-rule',
      'coherence-rule',
      'validation-rule',
      'local-rule',
      'local-set-rule',
    ]);
  });

  it('compiles schemas that use rule import refs in $metadata.rules', () => {
    expect(() => createValidator(join(FIXTURES_DIR, 'compile/rule-import-root.json'))).not.toThrow();
  });

  it('compiles schemas where only one metadata provider defines hierarchy', () => {
    expect(() => createValidator(join(FIXTURES_DIR, 'merge-root.json'))).not.toThrow();
  });
});

describe('schema composition hierarchies', () => {
  const summarize = (metadata: ReturnType<typeof loadMetadata>) => ({
    main: metadata.hierarchy?.name,
    hierarchies: metadata.hierarchies?.map((h) => [h.name, h.levels.map((l) => l.type)]),
  });

  it('keeps each composed hierarchy separate and uses the root-declared one as main', () => {
    const metadata = loadMetadata(join(MULTI_DIR, 'declared-root.json'));
    expect(summarize(metadata)).toEqual({
      main: 'strategy',
      hierarchies: [
        ['work', ['goal', 'task']],
        ['_skills-pack', ['skill_area', 'skill']],
        ['strategy', ['vision', 'mission']],
      ],
    });
  });

  it('uses a single contributed hierarchy as the implicit main hierarchy', () => {
    const metadata = loadMetadata(join(MULTI_DIR, 'single-contributed-root.json'));
    expect(summarize(metadata)).toEqual({
      main: '_skills-pack',
      hierarchies: [['_skills-pack', ['skill_area', 'skill']]],
    });
  });

  it('names a hierarchy after its declaring schema file stem by default', () => {
    const metadata = loadMetadata(join(bundledSchemasDir, 'strict_ost.json'));
    expect(metadata.hierarchy?.name).toBe('_ost_strict');
  });

  it('selects the main hierarchy with hierarchy: { $ref }', () => {
    const metadata = loadMetadata(join(MULTI_DIR, 'selected-root.json'));
    expect(summarize(metadata)).toEqual({
      main: 'work',
      hierarchies: [
        ['work', ['goal', 'task']],
        ['_skills-pack', ['skill_area', 'skill']],
      ],
    });
  });

  it('fails when several hierarchies are contributed and none is selected', () => {
    expect(() => loadMetadata(join(MULTI_DIR, 'unselected-root.json'))).toThrow(
      'composes multiple hierarchies ("work", "_skills-pack") but selects none as its main hierarchy',
    );
  });

  it('fails when a root both declares a hierarchy and selects one with $ref', () => {
    expect(() => loadMetadata(join(MULTI_DIR, 'declare-and-ref-root.json'))).toThrow(
      'hierarchy both declares levels and selects a hierarchy with "$ref"',
    );
  });

  it('compiles a schema that selects its main hierarchy with $ref', () => {
    expect(() => createValidator(join(MULTI_DIR, 'selected-root.json'))).not.toThrow();
  });
});
