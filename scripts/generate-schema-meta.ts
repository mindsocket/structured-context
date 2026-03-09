import { mkdir, writeFile } from 'node:fs/promises';
import { OST_TOOLS_DIALECT_META_SCHEMA } from '../src/metadata-contract.js';

const OUTPUT_PATH = new URL('../schemas/generated/_ost_tools_schema_meta.json', import.meta.url);

// Ensure the generated directory exists
await mkdir(new URL('.', OUTPUT_PATH), { recursive: true });

// Write the schema as formatted JSON
await writeFile(OUTPUT_PATH, `${JSON.stringify(OST_TOOLS_DIALECT_META_SCHEMA, null, 2)}\n`);

console.log(`Generated schema metadata: ${OUTPUT_PATH.pathname}`);
