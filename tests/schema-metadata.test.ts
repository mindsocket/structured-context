import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { bundledSchemasDir, createValidator, loadMetadata } from '../src/schema';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures/schema-metadata');
const GENERAL_SCHEMA_PATH = join(bundledSchemasDir, 'general.json');
const VALID_SCHEMA_PATH = join(FIXTURES_DIR, 'valid.json');
const INVALID_SCHEMA_PATH = join(FIXTURES_DIR, 'invalid-metadata.json');

describe('schema metadata', () => {
  it('loads top-level $metadata from bundled schemas', () => {
    const metadata = loadMetadata(GENERAL_SCHEMA_PATH);

    expect(metadata.hierarchy.levels.map((level) => level.type)).toEqual([
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

  it('rejects invalid $metadata in ost-tools schema dialect', () => {
    expect(() => createValidator(INVALID_SCHEMA_PATH)).toThrow();
  });
});
