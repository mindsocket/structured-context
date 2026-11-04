import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { bundledSchemasDir } from '../../src/schema/schema';
import { createSpaceContext } from '../../src/space-context';
import type { FileValidationResult } from '../../src/types';
import { validateFile, validateSpace } from '../../src/validate';
import { validateFileWith } from '../helpers/validate-run';

const META =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json';
const STRICT_SCHEMA_PATH = join(bundledSchemasDir, 'strict_ost.json');

/** An invalid `type` is keyed differently in the two views (the view lists the types in schema order). */
const normaliseKey = (key: string) =>
  key.startsWith('schema:type:') || key.startsWith('schema:/type:enum:') ? 'schema:invalid-type' : key;

describe('validateFile is a view over the validateSpace core', () => {
  const config: Config = {
    spaces: [
      { name: 'invalid', path: join(import.meta.dir, '../fixtures/strict_ost/invalid'), schema: STRICT_SCHEMA_PATH },
    ],
  };
  const context = createSpaceContext('invalid', config, { configDir: import.meta.dir });

  it('reports for each file exactly the issues validateSpace reports for it', async () => {
    const space = await validateSpace(context);
    const files = new Set<string>([
      ...space.nodeErrors.map((e) => e.nodeId),
      ...space.refErrors.map((e) => e.nodeId),
      ...space.duplicateErrors.map((e) => e.id),
      ...space.ruleViolations.map((v) => v.nodeId ?? ''),
      ...space.hierarchyViolations.map((v) => v.nodeId ?? ''),
      ...space.unresolvedContentLinks.map((l) => l.nodeId),
      ...space.coverageGates.flatMap((g) => g.gatedNodeIds),
    ]);
    files.delete('');
    expect(files.size).toBeGreaterThan(1);

    for (const file of files) {
      const expected = [
        ...space.nodeErrors
          .filter((e) => e.nodeId === file)
          .flatMap((e) => e.issues.map((f) => `schema:${f.dedupeKey}`)),
        ...space.duplicateErrors.filter((d) => d.id === file).map((d) => `duplicate:${d.id}`),
        ...space.refErrors.filter((r) => r.nodeId === file).map((r) => `broken-link:${r.parent}`),
        ...space.hierarchyViolations.filter((v) => v.nodeId === file).map((v) => `hierarchy:${v.description}`),
        ...space.ruleViolations.filter((v) => v.nodeId === file).map((v) => `rule:${v.ruleId}`),
        ...space.coverageGates.filter((g) => g.gatedNodeIds.some((id) => id === file)).map((g) => `gated:${g.nodeId}`),
        ...space.unresolvedContentLinks.filter((l) => l.nodeId === file).map((l) => `content-link:${l.target}`),
      ].map(normaliseKey);

      const result = (await validateFile(join(context.space.path, file), config, {
        configDir: import.meta.dir,
      })) as FileValidationResult;
      const actual = Object.keys({ ...result.errors, ...result.warnings }).map(normaliseKey);
      expect(actual.sort()).toEqual([...new Set(expected)].sort());
    }
  });
});

describe('judging a node with an expression rule violation', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** One file `A.md` of type `item`, violating an expression rule at `severity`, plus a semantic rule. */
  function setup(hierarchy: boolean, severity: string) {
    const dir = mkdtempSync(join(tmpdir(), 'sctx-views-'));
    dirs.push(dir);
    const schemaPath = join(dir, 'schema.json');
    const rules = [
      {
        id: 'never-holds',
        type: 'item',
        expression: 'false',
        category: 'validation',
        severity,
        description: 'never holds',
      },
      {
        id: 'sound',
        type: 'item',
        semantic: {},
        category: 'validation',
        severity: 'warning',
        description: 'sound',
      },
    ];
    writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: META,
        $id: 'sctx://views.test',
        $metadata: { ...(hierarchy && { hierarchy: { levels: ['item'] } }), rules },
        oneOf: [
          {
            type: 'object',
            properties: { type: { const: 'item' }, title: { type: 'string' } },
            required: ['type', 'title'],
          },
        ],
      }),
    );
    const space = join(dir, 'space');
    mkdirSync(space);
    writeFileSync(join(space, 'A.md'), '---\ntype: item\n---\n');
    const config: Config = { spaces: [{ name: 'views', path: space, schema: schemaPath }] };
    return { config, dir, file: join(space, 'A.md') };
  }

  const judgedRules = (judge: FakeJudgeProvider) => judge.callHistory.flatMap((c) => c.rules.map((r) => r.id));

  for (const hierarchy of [false, true]) {
    const label = hierarchy ? 'with' : 'without';

    it(`skips the node's semantic rules after a gating violation, ${label} a hierarchy`, async () => {
      const { config, dir, file } = setup(hierarchy, 'error');
      const judge = new FakeJudgeProvider({ pass: true });
      const result = (await validateFileWith(file, config, { judge, configDir: dir })) as FileValidationResult;
      expect(result.errors['rule:never-holds']).toBeDefined();
      expect(judgedRules(judge)).toEqual([]);
    });

    it(`still judges the node after a non-gating violation, ${label} a hierarchy`, async () => {
      const { config, dir, file } = setup(hierarchy, 'info');
      const judge = new FakeJudgeProvider({ pass: true });
      const result = (await validateFileWith(file, config, { judge, configDir: dir })) as FileValidationResult;
      expect(result.warnings['rule:never-holds']).toBeDefined();
      expect(judgedRules(judge)).toEqual(['sound']);
    });
  }
});

describe('invalid node type', () => {
  const config: Config = {
    spaces: [
      { name: 'invalid', path: join(import.meta.dir, '../fixtures/strict_ost/invalid'), schema: STRICT_SCHEMA_PATH },
    ],
  };
  const context = createSpaceContext('invalid', config, { configDir: import.meta.dir });

  it('reports one issue that lists the allowed types alphabetically', async () => {
    const { nodeErrors } = await validateSpace(context);
    const invalid = nodeErrors.filter((e) => e.issues.some((i) => i.message.startsWith('Invalid type "vision"')));
    const sorted = ['assumption_test', 'opportunity', 'outcome', 'solution'];
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.issues).toHaveLength(1);
    expect(invalid[0]?.issues[0]?.message).toEndWith(`Valid types are: ${sorted.join(', ')}`);
  });
});
