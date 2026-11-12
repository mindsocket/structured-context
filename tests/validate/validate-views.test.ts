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

describe('validateFile is a view over the validateSpace core', () => {
  const config: Config = {
    spaces: [
      { name: 'invalid', path: join(import.meta.dir, '../fixtures/strict_ost/invalid'), schema: STRICT_SCHEMA_PATH },
    ],
  };
  const context = createSpaceContext('invalid', config, { configDir: import.meta.dir });

  it('reports for each file exactly the issues validateSpace reports for it', async () => {
    const space = await validateSpace(context);
    const byNode = Map.groupBy(
      space.issues.filter((issue) => issue.nodeId !== undefined),
      (issue) => issue.nodeId!,
    );
    expect(byNode.size).toBeGreaterThan(1);

    for (const [file, expected] of byNode) {
      const result = (await validateFile(join(context.space.path, file), config, {
        configDir: import.meta.dir,
      })) as FileValidationResult;
      expect(result.issues).toEqual(expected);
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

  const judgedRules = (provider: FakeJudgeProvider) => provider.callHistory.flatMap((c) => c.rules.map((r) => r.id));

  for (const hierarchy of [false, true]) {
    const label = hierarchy ? 'with' : 'without';

    it(`skips the node's semantic rules after a gating violation, ${label} a hierarchy`, async () => {
      const { config, dir, file } = setup(hierarchy, 'error');
      const provider = new FakeJudgeProvider({ pass: true });
      const result = (await validateFileWith(file, config, {
        judge: { provider },
        configDir: dir,
      })) as FileValidationResult;
      expect(result.issues.some((issue) => issue.key === 'rule:never-holds')).toBe(true);
      expect(judgedRules(provider)).toEqual([]);
    });

    it(`still judges the node after a non-gating violation, ${label} a hierarchy`, async () => {
      const { config, dir, file } = setup(hierarchy, 'info');
      const provider = new FakeJudgeProvider({ pass: true });
      const result = (await validateFileWith(file, config, {
        judge: { provider },
        configDir: dir,
      })) as FileValidationResult;
      expect(result.issues.some((issue) => issue.key === 'rule:never-holds')).toBe(true);
      expect(judgedRules(provider)).toEqual(['sound']);
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
    const { issues } = await validateSpace(context);
    const invalid = issues.filter((issue) => issue.message.startsWith('Invalid type "vision"'));
    const sorted = ['assumption_test', 'opportunity', 'outcome', 'solution'];
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ kind: 'schema', severity: 'error' });
    expect(invalid[0]?.message).toEndWith(`Valid types are: ${sorted.join(', ')}`);
  });
});
