import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeMetaSchemas } from '../../scripts/generate-schema-meta';
import { listMetaVersions, loadMetaSchemas } from '../../src/schema/meta-schemas';
import {
  buildDialectMetaSchema,
  JSON_SCHEMA_DIALECT,
  SCHEMA_META_FILE,
  SCHEMA_META_ID,
  schemaMetaId,
} from '../../src/schema/metadata-contract';
import { bundledSchemasDir, createValidator } from '../../src/schema/schema';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sctx-meta-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeMetaSchemas', () => {
  const generatedUrl = () => pathToFileURL(`${dir}/`);
  const metaPath = (folder: string) => join(dir, folder, SCHEMA_META_FILE);

  it('writes only latest outside a release, stamped with the given version', async () => {
    expect(await writeMetaSchemas(generatedUrl(), '0.12.0', false)).toEqual(['latest']);
    expect(readdirSync(dir)).toEqual(['latest']);
    expect(readJson(metaPath('latest')).$id).toBe(schemaMetaId('0.12.0'));
  });

  it('freezes latest into a version folder on release when no version exists yet', async () => {
    expect(await writeMetaSchemas(generatedUrl(), '0.12.0', true)).toEqual(['latest', '0.12.0']);
    expect(readJson(metaPath('0.12.0'))).toEqual(readJson(metaPath('latest')));
    expect(readJson(metaPath('0.12.0')).$id).toBe(schemaMetaId('0.12.0'));
  });

  it('creates no folder for a release that does not change the dialect', async () => {
    await writeMetaSchemas(generatedUrl(), '0.12.0', true);
    expect(await writeMetaSchemas(generatedUrl(), '0.13.0', true)).toEqual(['latest']);
    expect(listMetaVersions(dir)).toEqual(['0.12.0']);
    expect(readJson(metaPath('latest')).$id).toBe(schemaMetaId('0.12.0'));
  });

  it('creates a new folder once the dialect differs from the newest version', async () => {
    await writeMetaSchemas(generatedUrl(), '0.12.0', true);
    const frozen = readJson(metaPath('0.12.0'));
    writeFileSync(metaPath('0.12.0'), JSON.stringify({ ...frozen, title: 'older dialect' }));

    expect(await writeMetaSchemas(generatedUrl(), '0.13.0', true)).toEqual(['latest', '0.13.0']);
    expect(readJson(metaPath('0.12.0')).title).toBe('older dialect');
    expect(readJson(metaPath('latest')).$id).toBe(schemaMetaId('0.13.0'));
    expect(listMetaVersions(dir)).toEqual(['0.12.0', '0.13.0']);
  });

  it('refuses to overwrite a released version folder', async () => {
    await writeMetaSchemas(generatedUrl(), '0.12.0', true);
    const frozen = readJson(metaPath('0.12.0'));
    writeFileSync(metaPath('0.12.0'), JSON.stringify({ ...frozen, title: 'older dialect' }));
    await expect(writeMetaSchemas(generatedUrl(), '0.12.0', true)).rejects.toThrow('immutable');
  });

  it('orders versions numerically, not lexically', async () => {
    for (const version of ['0.9.0', '0.10.0']) mkdirSync(join(dir, version));
    expect(listMetaVersions(dir)).toEqual(['0.9.0', '0.10.0']);
  });
});

describe('bundled meta-schemas', () => {
  const generatedDir = join(bundledSchemasDir, 'generated');
  const withoutId = (schema: object) => ({ ...schema, $id: undefined });

  it('latest matches the in-code dialect contract', () => {
    const latest = readJson(join(generatedDir, 'latest', SCHEMA_META_FILE));
    expect(withoutId(latest)).toEqual(withoutId(buildDialectMetaSchema(latest.$id)));
    expect(latest.$schema).toBe(JSON_SCHEMA_DIALECT);
  });

  it('latest carries the versioned $id, never the latest URL', () => {
    const latest = readJson(join(generatedDir, 'latest', SCHEMA_META_FILE));
    expect(latest.$id).toMatch(/\/generated\/\d+\.\d+\.\d+\/_structured_context_schema_meta\.json$/);
  });

  it('registers latest under the latest URL and each version at its $id', () => {
    const metas = loadMetaSchemas(bundledSchemasDir);
    expect(metas.get(SCHEMA_META_ID)?.$id).toBe(SCHEMA_META_ID);
    for (const version of listMetaVersions(generatedDir)) {
      expect(metas.has(schemaMetaId(version))).toBe(true);
    }
  });
});

describe('2020-12 dialect', () => {
  const writeSchema = (name: string, schema: object) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(schema));
    return path;
  };

  it('resolves $schema given as the latest URL and as every shipped version URL', () => {
    const ids = [...loadMetaSchemas(bundledSchemasDir).keys()];
    expect(ids).toContain(SCHEMA_META_ID);
    for (const [i, $schema] of ids.entries()) {
      const path = writeSchema(`s${i}.json`, { $schema, $id: `sctx://meta_ref_${i}`, type: 'object' });
      expect(createValidator(path)({})).toBe(true);
    }
  });

  it('closes objects composed via allOf with unevaluatedProperties: false', () => {
    const path = writeSchema('closed.json', {
      $schema: SCHEMA_META_ID,
      $id: 'sctx://closed',
      type: 'object',
      $defs: { base: { type: 'object', properties: { title: { type: 'string' } } } },
      allOf: [{ $ref: '#/$defs/base' }],
      properties: { kind: { const: 'closed' } },
      unevaluatedProperties: false,
    });
    const validate = createValidator(path);
    expect(validate({ title: 'a', kind: 'closed' })).toBe(true);
    expect(validate({ title: 'a', kind: 'closed', extra: 1 })).toBe(false);
  });

  it('applies keywords written beside $ref', () => {
    const path = writeSchema('sibling.json', {
      $schema: SCHEMA_META_ID,
      $id: 'sctx://sibling',
      type: 'object',
      $defs: { name: { type: 'string' } },
      properties: { name: { $ref: '#/$defs/name', type: 'string', minLength: 3 } },
    });
    const validate = createValidator(path);
    expect(validate({ name: 'abc' })).toBe(true);
    expect(validate({ name: 'ab' })).toBe(false);
  });

  it('rejects an invalid $metadata block via the dialect meta-schema', () => {
    const path = writeSchema('bad-meta.json', {
      $schema: SCHEMA_META_ID,
      $id: 'sctx://bad_meta',
      $metadata: { imports: [1] },
    });
    expect(() => createValidator(path)).toThrow();
  });
});
