import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { createValidator } from '../../src/schema/schema';

const TEST_SCHEMA_PATH = join(import.meta.dir, '../fixtures/test-schema.json');
const validateNode = createValidator(TEST_SCHEMA_PATH);

const base = { type: 'note', title: 'Test' };

describe('format: "path"', () => {
  it('accepts an absolute path', () => {
    expect(validateNode({ ...base, path: '/foo/bar/baz.md' })).toBe(true);
  });

  it('accepts a relative path', () => {
    expect(validateNode({ ...base, path: '../sibling/file.md' })).toBe(true);
  });

  it('accepts a plain filename with no slashes', () => {
    expect(validateNode({ ...base, path: 'notes' })).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateNode({ ...base, path: '' })).toBe(false);
  });

  it('rejects a string containing a null byte', () => {
    expect(validateNode({ ...base, path: 'foo\0bar' })).toBe(false);
  });
});

describe('format: "wikilink"', () => {
  it('accepts a valid wikilink', () => {
    expect(validateNode({ ...base, related: '[[Other Note]]' })).toBe(true);
  });

  it('accepts a wikilink with spaces and special characters', () => {
    expect(validateNode({ ...base, related: '[[My Note (2026)]]' })).toBe(true);
  });

  it('rejects a plain string without brackets', () => {
    expect(validateNode({ ...base, related: 'Other Note' })).toBe(false);
  });

  it('rejects single-bracket syntax', () => {
    expect(validateNode({ ...base, related: '[Other Note]' })).toBe(false);
  });

  it('rejects empty brackets', () => {
    expect(validateNode({ ...base, related: '[[]]' })).toBe(false);
  });
});
