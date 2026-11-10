import type { AnySchemaObject } from 'ajv';
import { mergeVariantProperties } from '../schema/schema-refs';
import type { SchemaWithMetadata } from '../types';
import type { JudgeTypeDefinition } from './types';

/** Fields every node has, whose meaning the prompt already gives. */
const OMITTED_FIELDS = new Set(['type', 'title', 'content']);

/** Type names an entity variant declares, through `type.const` or `type.enum`. */
function variantTypes(properties: Record<string, AnySchemaObject>): string[] {
  const typeDef = properties.type;
  if (typeDef?.const !== undefined) return [String(typeDef.const)];
  if (Array.isArray(typeDef?.enum)) return typeDef.enum.map(String);
  return [];
}

/**
 * What the schema says about each entity type, for the judge: the variant's `description`, each field's
 * `description` and enum values, and the type's neighbours in the main hierarchy. A field with neither a
 * description nor enum values is left out, and so is a type with nothing to say.
 */
export function judgeTypeDefinitions(
  schema: SchemaWithMetadata,
  schemaRefRegistry: Map<string, AnySchemaObject>,
): Map<string, JudgeTypeDefinition> {
  const out = new Map<string, JudgeTypeDefinition>();
  const levels = schema.metadata.hierarchy?.levels ?? [];
  const variants = Array.isArray(schema.oneOf) ? (schema.oneOf as AnySchemaObject[]) : [];
  for (const variant of variants) {
    const { properties } = mergeVariantProperties(variant, schema, schemaRefRegistry);
    const fields: JudgeTypeDefinition['fields'] = {};
    for (const [name, def] of Object.entries(properties)) {
      if (OMITTED_FIELDS.has(name)) continue;
      const description = typeof def.description === 'string' ? def.description : undefined;
      const values = Array.isArray(def.enum) ? def.enum.map(String) : undefined;
      if (description || values) fields[name] = { ...(description && { description }), ...(values && { values }) };
    }
    const description = typeof variant.description === 'string' ? variant.description : undefined;
    for (const type of variantTypes(properties)) {
      const index = levels.findIndex((l) => l.type === type);
      const parentType = index > 0 ? levels[index - 1]!.type : undefined;
      const childType = index >= 0 && index < levels.length - 1 ? levels[index + 1]!.type : undefined;
      const definition: JudgeTypeDefinition = {
        ...(description && { description }),
        ...(Object.keys(fields).length > 0 && { fields }),
        ...(parentType && { parentType }),
        ...(childType && { childType }),
      };
      if (Object.keys(definition).length > 0) out.set(type, definition);
    }
  }
  return out;
}

/** The definitions of the types an input mentions: the evaluated node's and its related nodes'. */
export function definitionsFor(
  definitions: ReadonlyMap<string, JudgeTypeDefinition> | undefined,
  types: Iterable<string>,
): Record<string, JudgeTypeDefinition> | undefined {
  if (!definitions) return undefined;
  const picked: Record<string, JudgeTypeDefinition> = {};
  for (const type of types) {
    const definition = definitions.get(type);
    if (definition) picked[type] = definition;
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}
