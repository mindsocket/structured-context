import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnySchemaObject } from 'ajv';
import { SCHEMA_META_FILE, SCHEMA_META_ID } from './metadata-contract';

const LATEST_FOLDER = 'latest';
const VERSION_FOLDER = /^\d+\.\d+\.\d+$/;

function compareVersions(a: string, b: string): number {
  const [pa, pb] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) {
    const diff = (pa?.[i] ?? 0) - (pb?.[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version folders under `generatedDir` (named after the release that first shipped the dialect), oldest first. */
export function listMetaVersions(generatedDir: string): string[] {
  if (!existsSync(generatedDir)) return [];
  return readdirSync(generatedDir)
    .filter((name) => VERSION_FOLDER.test(name))
    .sort(compareVersions);
}

function readMetaSchema(generatedDir: string, folder: string): AnySchemaObject | undefined {
  const path = join(generatedDir, folder, SCHEMA_META_FILE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as AnySchemaObject) : undefined;
}

/** The newest released meta-schema and its version folder, if any. */
export function readNewestMetaSchema(generatedDir: string): { version: string; schema: AnySchemaObject } | undefined {
  const version = listMetaVersions(generatedDir).at(-1);
  const schema = version && readMetaSchema(generatedDir, version);
  return version && schema ? { version, schema } : undefined;
}

/**
 * Meta-schemas shipped in `<schemasDir>/generated/`, keyed by `$id`: every versioned folder at its own `$id`, and
 * `latest` registered under the `latest` URL so `$schema` references to either form resolve.
 */
export function loadMetaSchemas(schemasDir: string): Map<string, AnySchemaObject> {
  const generatedDir = join(schemasDir, 'generated');
  const schemas = new Map<string, AnySchemaObject>();
  for (const version of listMetaVersions(generatedDir)) {
    const schema = readMetaSchema(generatedDir, version);
    if (schema && typeof schema.$id === 'string') schemas.set(schema.$id, schema);
  }
  // The `latest` copy carries its versioned `$id`, which a version folder may already own; register it under its own URL.
  const latest = readMetaSchema(generatedDir, LATEST_FOLDER);
  if (latest) schemas.set(SCHEMA_META_ID, { ...latest, $id: SCHEMA_META_ID });
  return schemas;
}
