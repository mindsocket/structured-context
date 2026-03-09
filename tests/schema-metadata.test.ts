import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceOnAPage } from '../src/read-space-on-a-page';
import { bundledSchemasDir, createValidator, loadMetadata } from '../src/schema';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures/schema-metadata');
const GENERAL_SCHEMA_PATH = join(bundledSchemasDir, 'general.json');
const VALID_SCHEMA_PATH = join(FIXTURES_DIR, 'valid.json');
const ALIAS_ONLY_SCHEMA_PATH = join(FIXTURES_DIR, 'alias-only.json');
const INVALID_SCHEMA_PATH = join(FIXTURES_DIR, 'invalid-metadata.json');
const ON_A_PAGE_FIXTURE_PATH = join(import.meta.dir, 'fixtures/general/on-a-page-valid.md');

describe('schema metadata', () => {
  it('loads top-level $metadata from bundled schemas', () => {
    const metadata = loadMetadata(GENERAL_SCHEMA_PATH);

    expect(metadata.hierarchy?.levels.map((level) => level.type)).toEqual([
      'vision',
      'mission',
      'goal',
      'opportunity',
      'solution',
      'experiment',
    ]);
    expect(metadata.typeAliases?.outcome).toBe('goal');
  });

  it('compiles schemas with top-level $metadata', () => {
    expect(() => createValidator(VALID_SCHEMA_PATH)).not.toThrow();
  });

  it('compiles schemas with alias-only $metadata and no hierarchy', () => {
    expect(() => createValidator(ALIAS_ONLY_SCHEMA_PATH)).not.toThrow();
    const metadata = loadMetadata(ALIAS_ONLY_SCHEMA_PATH);
    expect(metadata.hierarchy).toBeUndefined();
    expect(metadata.typeAliases).toEqual({ outcome: 'goal' });
  });

  it('fails to read space_on_a_page when hierarchy metadata is absent', () => {
    expect(() => readSpaceOnAPage(ON_A_PAGE_FIXTURE_PATH, ALIAS_ONLY_SCHEMA_PATH)).toThrow(
      'must define "$metadata.hierarchy.levels"',
    );
  });

  it('rejects invalid $metadata in ost-tools schema dialect', () => {
    expect(() => createValidator(INVALID_SCHEMA_PATH)).toThrow();
  });
});
