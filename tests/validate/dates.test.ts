import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceDirectory } from '../../src/plugins/markdown/read-space';
import { createValidator } from '../../src/schema/schema';
import { makePluginContext } from '../helpers/context';

const TEST_SCHEMA_PATH = join(import.meta.dir, '../fixtures/test-schema.json');
const VALID_DIR = join(import.meta.dir, '../fixtures/dates/valid');

const validateNode = createValidator(TEST_SCHEMA_PATH);

describe('dates and format validation', () => {
  describe('readSpaceDirectory with unquoted YAML date and datetime', () => {
    let nodes: Awaited<ReturnType<typeof readSpaceDirectory>>['nodes'];

    beforeAll(async () => {
      ({ nodes } = await readSpaceDirectory(makePluginContext(VALID_DIR, TEST_SCHEMA_PATH)));
    });

    it('produces one node', () => {
      expect(nodes).toHaveLength(1);
    });

    it('keeps the date and datetime as written', () => {
      expect(nodes[0]?.schemaData.date).toBe('2026-03-31');
      expect(nodes[0]?.schemaData.updated).toBe('2026-03-31T09:15:00+10:00');
    });

    it('passes schema validation', () => {
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

    it.each(['2026-13-01', '2026-02-30', '2026-04-31'])('rejects impossible date %s', (value) => {
      expect(validateNode({ type: 'note', title: 'Test', date: value })).toBe(false);
    });

    it('rejects a Date object', () => {
      expect(validateNode({ type: 'note', title: 'Test', date: new Date('2026-03-31') })).toBe(false);
    });
  });

  describe('format: "date-time" schema validation', () => {
    it.each([
      '2026-03-31T09:15:00Z',
      '2026-03-31T09:15:00.250Z',
      '2026-03-31T09:15:00+10:00',
    ])('accepts %s', (value) => {
      expect(validateNode({ type: 'note', title: 'Test', updated: value })).toBe(true);
    });

    it.each([
      '2026-03-31',
      '2026-03-31T09:15:00',
      '2026-03-31T09:15Z',
      '2026-03-31 09:15:00Z',
      '2026-02-31T09:15:00Z',
      '2026-03-31T24:00:00Z',
      '2026-03-31T09:60:00Z',
      '2026-03-31T09:15:00+25:00',
    ])('rejects %s', (value) => {
      expect(validateNode({ type: 'note', title: 'Test', updated: value })).toBe(false);
    });
  });

  describe('format: "date-or-date-time" schema validation', () => {
    it.each([
      '2026-03-31',
      '2026-03-31T09:15:00Z',
      '2026-03-31T09:15:00+10:00',
      '2026-03-31T09:15:00',
      '2026-03-31T09:15',
    ])('accepts %s', (value) => {
      expect(validateNode({ type: 'note', title: 'Test', when: value })).toBe(true);
    });

    it.each(['2026-02-29', '2026-03-31T25:00', '2026-03-31 09:15', '31/03/2026', 'today'])('rejects %s', (value) => {
      expect(validateNode({ type: 'note', title: 'Test', when: value })).toBe(false);
    });
  });
});
