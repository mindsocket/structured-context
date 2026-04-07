import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { DIALECT_META_SCHEMA } from '../src/schema/metadata-contract';

const OUTPUT_PATH = new URL('../schemas/generated/_structured_context_schema_meta.json', import.meta.url);

// Ensure the generated directory exists
await mkdir(new URL('.', OUTPUT_PATH), { recursive: true });

// Write the schema as formatted JSON
await writeFile(OUTPUT_PATH, `${JSON.stringify(DIALECT_META_SCHEMA, null, 2)}\n`);

// Format the generated file with biome
execSync(`bunx biome check --write ${OUTPUT_PATH.pathname}`, {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
});

console.log(`Generated schema metadata: ${OUTPUT_PATH.pathname}`);
