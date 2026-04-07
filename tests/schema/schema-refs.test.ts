import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { AnySchemaObject, SchemaObject } from 'ajv';
import { buildFullRegistry, readRawSchema } from '../../src/schema/schema';
import { mergeVariantProperties, resolveRef } from '../../src/schema/schema-refs';

const ROOT_SCHEMA_PATH = join(import.meta.dir, '..', 'fixtures/schema-refs/root.json');

describe('schema refs', () => {
  it('resolves external refs transitively across multiple files', () => {
    const schema = readRawSchema(ROOT_SCHEMA_PATH) as SchemaObject;
    const schemaRefRegistry = buildFullRegistry(ROOT_SCHEMA_PATH) as Map<string, AnySchemaObject>;
    const variant = schema.oneOf?.[0] as AnySchemaObject;

    const { properties, required } = mergeVariantProperties(variant, schema, schemaRefRegistry);

    expect((properties.mood as { enum?: string[] }).enum).toEqual(['happy', 'sad']);
    expect((properties.status as { enum?: string[] }).enum).toContain('active');
    expect((properties.score as { minimum?: number; maximum?: number }).minimum).toBe(1);
    expect((properties.score as { minimum?: number; maximum?: number }).maximum).toBe(5);
    expect(required).toEqual(expect.arrayContaining(['type', 'mood', 'status', 'score']));
  });

  it('resolves bundled refs from local schemas', () => {
    const schema = readRawSchema(ROOT_SCHEMA_PATH) as SchemaObject;
    const schemaRefRegistry = buildFullRegistry(ROOT_SCHEMA_PATH) as Map<string, AnySchemaObject>;

    const status = resolveRef({ $ref: 'sctx://_sctx_base#/$defs/status' }, schema, schemaRefRegistry) as {
      enum?: string[];
    };

    expect(status.enum).toContain('exploring');
  });

  it('detects cycles in mutually recursive allOf schemas', () => {
    // Schema A: { "$id": "A", "allOf": [{ "$ref": "B" }] }
    // Schema B: { "$id": "B", "allOf": [{ "$ref": "A" }] }
    const schemaA: AnySchemaObject = {
      $id: 'http://example.com/A',
      allOf: [{ $ref: 'http://example.com/B' }],
      properties: { fromA: { type: 'string' } },
    };
    const schemaB: AnySchemaObject = {
      $id: 'http://example.com/B',
      allOf: [{ $ref: 'http://example.com/A' }],
      properties: { fromB: { type: 'number' } },
    };

    const schemaRefRegistry = new Map<string, AnySchemaObject>([
      ['http://example.com/A', schemaA],
      ['http://example.com/B', schemaB],
    ]);

    // This should not throw or infinite loop - it should detect the cycle and return a result
    const { properties, required } = mergeVariantProperties(schemaA, schemaA, schemaRefRegistry);

    // Both properties should be present despite the cycle
    expect(properties.fromA).toBeDefined();
    expect(properties.fromB).toBeDefined();
    expect(required).toEqual([]);
  });
});
