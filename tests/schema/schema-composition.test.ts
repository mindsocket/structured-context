import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { createValidator, loadMetadata } from '../../src/schema/schema';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures/schema-composition');

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

  it('uses root schema hierarchy when multiple providers define one', () => {
    const metadata = loadMetadata(join(FIXTURES_DIR, 'hierarchy-conflict-root.json'));
    // Root schema defines hierarchy with only ["goal"]; partial defines ["vision", "goal"].
    // Root wins — it is processed last and overrides the partial.
    expect(metadata.hierarchy?.levels.map((l) => l.type)).toEqual(['goal']);
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
