import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import pkg from '../package.json';
import { readNewestMetaSchema } from '../src/schema/meta-schemas';
import { buildDialectMetaSchema, SCHEMA_META_FILE, schemaMetaId } from '../src/schema/metadata-contract';
import {
  SPACE_GRAPH_DATA_SCHEMA,
  SPACE_GRAPH_FORMAT_VERSION,
  SPACE_GRAPH_SCHEMA_DIR,
  spaceGraphSchemaId,
} from '../src/space-graph-data';

const GENERATED_DIR = new URL('../schemas/generated/', import.meta.url);

/** Compare meta-schemas ignoring `$id`, which names the folder holding the schema and so differs by design. */
const withoutId = (schema: object) => JSON.stringify({ ...schema, $id: undefined });

/**
 * Write the current dialect to `generated/latest/`. With `release`, also freeze it as `generated/<version>/`
 * when it differs from the newest version folder; otherwise `latest` keeps the newest folder's `$id`.
 */
export async function writeMetaSchemas(generatedDir: URL, version: string, release: boolean): Promise<string[]> {
  const newest = readNewestMetaSchema(generatedDir.pathname);
  const current = buildDialectMetaSchema(schemaMetaId(version));
  const changed = !newest || withoutId(newest.schema) !== withoutId(current);
  const id = changed ? schemaMetaId(version) : schemaMetaId(newest.version);
  const content = `${JSON.stringify({ ...current, $id: id }, null, 2)}\n`;

  const folders = ['latest', ...(release && changed ? [version] : [])];
  for (const folder of folders) {
    const dir = new URL(`${folder}/`, generatedDir);
    if (folder !== 'latest' && existsSync(dir))
      throw new Error(`Meta-schema folder ${folder} already exists; released versions are immutable.`);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL(SCHEMA_META_FILE, dir), content);
  }
  return folders;
}

/**
 * Write the space graph format schema to `space-graph/latest.json`. With `release`, also freeze it as
 * `space-graph/<formatVersion>.json`. Throws when the schema differs from an already frozen file for the same version.
 */
export async function writeSpaceGraphSchema(generatedDir: URL, release: boolean): Promise<string[]> {
  const dir = new URL(`${SPACE_GRAPH_SCHEMA_DIR}/`, generatedDir);
  const version = String(SPACE_GRAPH_FORMAT_VERSION);
  const schema = { $id: spaceGraphSchemaId(version), ...SPACE_GRAPH_DATA_SCHEMA };
  const frozen = new URL(`${version}.json`, dir);
  if (existsSync(frozen) && JSON.stringify(JSON.parse(readFileSync(frozen, 'utf-8'))) !== JSON.stringify(schema)) {
    throw new Error(
      `The space graph format changed after version ${version} was released. Bump SPACE_GRAPH_FORMAT_VERSION.`,
    );
  }

  const files = ['latest', ...(release && !existsSync(frozen) ? [version] : [])];
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    await writeFile(new URL(`${file}.json`, dir), `${JSON.stringify(schema, null, 2)}\n`);
  }
  return files;
}

if (import.meta.main) {
  const release = process.argv.includes('--release');
  const folders = await writeMetaSchemas(GENERATED_DIR, pkg.version, release);
  const graphFiles = await writeSpaceGraphSchema(GENERATED_DIR, release);
  execSync(`bunx biome check --config-path=. --write ${GENERATED_DIR.pathname}`, {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'inherit',
  });
  console.log(`Generated schema metadata: ${folders.join(', ')}`);
  console.log(`Generated space graph schema: ${graphFiles.join(', ')}`);
}
