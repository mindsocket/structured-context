import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { AnySchemaObject, SchemaObject } from 'ajv';
import { buildFullRegistry, readRawSchema } from '../src/schema';
import { mergeVariantProperties, resolveRef } from '../src/schema-refs';

const ROOT_SCHEMA_PATH = join(import.meta.dir, 'fixtures/schema-refs/root.json');

describe('schema refs', () => {
  it('resolves external refs transitively across multiple files', () => {
    const schema = readRawSchema(ROOT_SCHEMA_PATH) as SchemaObject;
    const registry = buildFullRegistry(ROOT_SCHEMA_PATH) as Map<string, AnySchemaObject>;
    const variant = schema.oneOf?.[0] as AnySchemaObject;

    const { properties, required } = mergeVariantProperties(variant, schema, registry);

    expect((properties.mood as { enum?: string[] }).enum).toEqual(['happy', 'sad']);
    expect((properties.status as { enum?: string[] }).enum).toContain('active');
    expect((properties.score as { minimum?: number; maximum?: number }).minimum).toBe(1);
    expect((properties.score as { minimum?: number; maximum?: number }).maximum).toBe(5);
    expect(required).toEqual(expect.arrayContaining(['type', 'mood', 'status', 'score']));
  });

  it('resolves bundled refs from local schemas', () => {
    const schema = readRawSchema(ROOT_SCHEMA_PATH) as SchemaObject;
    const registry = buildFullRegistry(ROOT_SCHEMA_PATH) as Map<string, AnySchemaObject>;

    const status = resolveRef({ $ref: 'ost-tools://_ost_tools_base#/$defs/status' }, schema, registry) as {
      enum?: string[];
    };

    expect(status.enum).toContain('exploring');
  });
});
