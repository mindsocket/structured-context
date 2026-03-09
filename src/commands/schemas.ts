import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AnySchemaObject, SchemaObject } from 'ajv';
import JSON5 from 'json5';
import { loadConfig, resolveSchema } from '../config';
import { buildFullRegistry, bundledSchemasDir, loadMetadata, mergeVariantProperties, readRawSchema } from '../schema';
import type { SchemaMetadata } from '../types';

function isBundledPath(schemaPath: string): boolean {
  return dirname(schemaPath) === bundledSchemasDir;
}

function extractRefs(obj: unknown, refs: Set<string>): void {
  if (typeof obj !== 'object' || obj === null) return;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      refs.add(value);
    } else {
      extractRefs(value, refs);
    }
  }
}

interface EntityVariant {
  types: string[];
  properties: string[];
  required: string[];
}

function extractEntities(
  oneOf: unknown[],
  registry: Map<string, AnySchemaObject>,
  schema: SchemaObject,
): EntityVariant[] {
  return oneOf.map((entry) => {
    const { properties, required } = mergeVariantProperties(entry as AnySchemaObject, schema, registry);
    const typeDef = properties.type as AnySchemaObject | undefined;
    let types: string[] = [];
    if (typeDef?.const) types = [String(typeDef.const)];
    else if (Array.isArray(typeDef?.enum)) types = (typeDef.enum as unknown[]).map(String);

    return {
      types,
      properties: Object.keys(properties).filter((k) => k !== 'type'),
      required: required.filter((r) => r !== 'type'),
    };
  });
}

function showEntities(oneOf: unknown[], registry: Map<string, AnySchemaObject>, schema: SchemaObject): void {
  const entities = extractEntities(oneOf, registry, schema);
  console.log('\nEntities:');
  for (const { types, properties, required } of entities) {
    const label = types.length > 0 ? types.join(', ') : '(unknown)';
    if (properties.length === 0) {
      console.log(`  ${label}`);
    } else {
      const propList = properties.map((p) => (required.includes(p) ? `${p}*` : p)).join('  ');
      console.log(`  ${label}`);
      console.log(`    ${propList}`);
    }
  }
}

function showDefs(defs: Record<string, unknown>): void {
  const keys = Object.keys(defs).filter((k) => !k.startsWith('_'));
  if (keys.length === 0) return;
  console.log('\nDefinitions:');
  for (const key of keys) {
    const def = defs[key] as Record<string, unknown>;
    const props = def.properties ? Object.keys(def.properties as object) : [];
    const desc = def.description ? ` — ${def.description}` : '';
    if (props.length > 0) {
      console.log(`  ${key}${desc}`);
      console.log(`    properties: ${props.join(', ')}`);
    } else {
      const typeInfo = def.type ? ` (${def.type})` : '';
      const enumInfo = Array.isArray(def.enum) ? ` [${(def.enum as unknown[]).join(', ')}]` : '';
      console.log(`  ${key}${typeInfo}${enumInfo}${desc}`);
    }
  }
}

function showMetadata(metadata: SchemaMetadata): void {
  const parts = metadata.levels.map((l) => (l.selfRef ? `${l.type}(+)` : l.type));
  console.log(`\nhierarchy: ${parts.join(' → ')}`);

  if (metadata.aliases && Object.keys(metadata.aliases).length > 0) {
    const aliasParts = Object.entries(metadata.aliases).map(([k, v]) => `${k} → ${v}`);
    console.log(`aliases: ${aliasParts.join(', ')}`);
  }

  if (metadata.rules) {
    const groups = Object.entries(metadata.rules).filter(([, v]) => Array.isArray(v) && v.length > 0);
    if (groups.length > 0) {
      console.log('\nRules:');
      for (const [group, items] of groups) {
        console.log(`  ${group}:`);
        for (const item of items as Record<string, unknown>[]) {
          console.log(`    ${item.id}: ${item.description}`);
        }
      }
    }
  }
}

function showRegistry(schemaPath: string, registry: Map<string, AnySchemaObject>): void {
  const bundledIds = new Set<string>();
  if (existsSync(bundledSchemasDir)) {
    for (const file of readdirSync(bundledSchemasDir).filter((f) => f.endsWith('.json'))) {
      const s = readRawSchema(join(bundledSchemasDir, file));
      if (typeof s.$id === 'string') bundledIds.add(s.$id);
    }
  }
  console.log(`\nRegistry (${schemaPath}):`);
  for (const [id] of registry) {
    console.log(`  [${bundledIds.has(id) ? 'bundled' : 'local'}]  ${id}`);
  }
}

export function listSchemas(): void {
  const config = loadConfig();

  // List all schemas known to config
  if (existsSync(bundledSchemasDir)) {
    const files = readdirSync(bundledSchemasDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    if (files.length > 0) {
      console.log('Bundled schemas:');
      for (const file of files) {
        const schema = readRawSchema(join(bundledSchemasDir, file));
        const id = typeof schema.$id === 'string' ? schema.$id : '(no $id)';
        console.log(`  ${file}${file.startsWith('_') ? '  [partial]' : ''}  (${id})`);
      }
    }
  }

  const configured: Array<{ source: string; path: string }> = [];
  const seen = new Set<string>();

  if (config.schema && !isBundledPath(config.schema)) {
    configured.push({ source: 'global', path: config.schema });
    seen.add(config.schema);
  }

  for (const space of config.spaces) {
    if (space.schema && !seen.has(space.schema) && !isBundledPath(space.schema)) {
      configured.push({ source: space.alias, path: space.schema });
      seen.add(space.schema);
    }
  }

  if (configured.length > 0) {
    console.log('\nConfigured schemas:');
    for (const { source, path } of configured) {
      console.log(`  ${source}: ${path}`);
    }
  }
}

export function showSchema(file: string | undefined, options: { space?: string; raw: boolean }): void {
  const config = loadConfig();

  let schemaPath: string;
  if (options.space) {
    const space = config.spaces.find((s) => s.alias === options.space);
    if (!space) {
      console.error(`Error: Unknown space "${options.space}"`);
      process.exit(1);
    }
    schemaPath = resolveSchema(undefined, config, space);
  } else if (!file) {
    console.error('Error: specify a file argument or use --space');
    process.exit(1);
  } else if (file.startsWith('/') || file.startsWith('./')) {
    schemaPath = file;
  } else {
    schemaPath = join(bundledSchemasDir, file.endsWith('.json') ? file : `${file}.json`);
  }

  if (!existsSync(schemaPath)) {
    console.error(`Schema not found: ${schemaPath}`);
    process.exit(1);
  }

  const content = readFileSync(schemaPath, 'utf-8');

  if (options.raw) {
    process.stdout.write(content);
    return;
  }

  const schema = JSON5.parse(content) as SchemaObject;
  const registry = buildFullRegistry(schemaPath) as Map<string, AnySchemaObject>;

  console.log(`$id: ${schema.$id ?? '(none)'}`);
  if (schema.title) console.log(`title: ${schema.title}`);
  if (schema.description) console.log(`description: ${schema.description}`);

  showMetadata(loadMetadata(schemaPath));

  if (Array.isArray(schema.oneOf)) {
    showEntities(schema.oneOf, registry, schema);
  }

  const defs = schema.$defs as Record<string, unknown> | undefined;
  if (defs) showDefs(defs);

  const refs = new Set<string>();
  extractRefs(schema, refs);
  if (refs.size > 0) {
    console.log('\n$refs:');
    for (const ref of [...refs].sort()) {
      console.log(`  ${ref}`);
    }
  }

  showRegistry(schemaPath, registry);
}
