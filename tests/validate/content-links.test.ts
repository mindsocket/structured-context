import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { createSpaceContext } from '../../src/space-context';
import type { FileValidationResult } from '../../src/types';
import { validateFile, validateSpace } from '../../src/validate';
import { ofKind, withKey } from '../helpers/issues';

const META =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json';

describe('unresolved content links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sctx-content-links-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const schemaPath = join(dir, 'schema.json');
  writeFileSync(
    schemaPath,
    JSON.stringify({
      $schema: META,
      $id: 'sctx://content-links.test',
      $metadata: {},
      oneOf: [{ type: 'object', properties: { type: { const: 'item' }, title: { type: 'string' } } }],
    }),
  );
  const space = join(dir, 'space');
  mkdirSync(join(space, 'notes'), { recursive: true });
  writeFileSync(
    join(space, 'A.md'),
    [
      '---',
      'type: item',
      '---',
      '[[B]] [[Untyped]] [[notes/Untyped#Heading]] [[No frontmatter]] [[Missing]] [gone](gone.md)',
    ].join('\n'),
  );
  writeFileSync(join(space, 'B.md'), '---\ntype: item\n---\n');
  writeFileSync(join(space, 'notes/Untyped.md'), '---\ntags: [x]\n---\n');
  writeFileSync(join(space, 'No frontmatter.md'), 'Just text.\n');
  const config: Config = { spaces: [{ name: 'links', path: space, schema: schemaPath }] };

  it('resolves links to files the space read but excluded, and reports missing targets', async () => {
    const result = await validateSpace(createSpaceContext('links', config, { configDir: dir }));
    const links = ofKind(result.issues, 'content-link');
    expect(links.map((l) => l.target).sort()).toEqual(['Missing', 'gone.md']);
    expect(links.every((l) => l.severity === 'info')).toBe(true);
  });

  it('reports the same for a single file', async () => {
    const result = (await validateFile(join(space, 'A.md'), config, { configDir: dir })) as FileValidationResult;
    expect(result.issues.map((issue) => issue.key).sort()).toEqual(['content-link:Missing', 'content-link:gone.md']);
    expect(withKey(result.issues, 'content-link:Missing')?.severity).toBe('info');
  });
});
