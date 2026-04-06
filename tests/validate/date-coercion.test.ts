import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceDirectory } from '../../src/plugins/markdown/read-space';
import { createValidator } from '../../src/schema/schema';
import { makePluginContext } from '../helpers/context';

const TEST_SCHEMA_PATH = join(import.meta.dir, '../fixtures/test-schema.json');
const VALID_DIR = join(import.meta.dir, '../fixtures/date-coercion/valid');

const validateNode = createValidator(TEST_SCHEMA_PATH);

describe('date coercion and format validation', () => {
  describe('readSpaceDirectory with unquoted YAML date', () => {
    let nodes: Awaited<ReturnType<typeof readSpaceDirectory>>['nodes'];

    beforeAll(async () => {
      ({ nodes } = await readSpaceDirectory(makePluginContext(VALID_DIR, TEST_SCHEMA_PATH)));
    });

    it('produces one node', () => {
      expect(nodes).toHaveLength(1);
    });

    it('coerces Date object to ISO date string', () => {
      expect(nodes[0]?.schemaData.date).toBe('2026-03-31');
      expect(nodes[0]?.schemaData.date).toBeTypeOf('string');
    });

    it('coerced date passes schema validation', () => {
      expect(validateNode(nodes[0]?.schemaData)).toBe(true);
    });
  });

  describe('format: "date" schema validation', () => {
    it('accepts a valid ISO date string', () => {
      expect(validateNode({ type: 'note', title: 'Test', date: '2026-03-31' })).toBe(true);
    });

    it('rejects a non-date string', () => {
      expect(validateNode({ type: 'note', title: 'Test', date: 'not-a-date' })).toBe(false);
    });

    it('rejects a datetime string for a date field', () => {
      expect(validateNode({ type: 'note', title: 'Test', date: '2026-03-31T00:00:00Z' })).toBe(false);
    });

    it('rejects a Date object (unconverted)', () => {
      expect(validateNode({ type: 'note', title: 'Test', date: new Date('2026-03-31') })).toBe(false);
    });
  });
});
