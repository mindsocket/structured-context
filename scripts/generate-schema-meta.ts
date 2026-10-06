import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import pkg from '../package.json';
import { readNewestMetaSchema } from '../src/schema/meta-schemas';
import { buildDialectMetaSchema, SCHEMA_META_FILE, schemaMetaId } from '../src/schema/metadata-contract';

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

if (import.meta.main) {
  const release = process.argv.includes('--release');
  const folders = await writeMetaSchemas(GENERATED_DIR, pkg.version, release);
  execSync(`bunx biome check --config-path=. --write ${GENERATED_DIR.pathname}`, {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'inherit',
  });
  console.log(`Generated schema metadata: ${folders.join(', ')}`);
}
