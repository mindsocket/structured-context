import { readFileSync } from 'fs';
import Ajv from 'ajv';
import { readSpace } from './read-space.js';

interface ValidationResult {
  schemaValidCount: number;
  schemaErrorCount: number;
  schemaErrors: Array<{ file: string; errors: any[] }>;
  refErrors: Array<{ file: string; parent: string; error: string }>;
  skipped: string[];
  nonOst: string[];
}

export async function validate(directory: string, options: { schema?: string }) {
  const schemaPath = options.schema || 'schema.json';
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv();
  const validateFunc = ajv.compile(schema);

  const { nodes, skipped, nonOst } = await readSpace(directory);

  const result: ValidationResult = {
    schemaValidCount: 0,
    schemaErrorCount: 0,
    schemaErrors: [],
    refErrors: [],
    skipped,
    nonOst,
  };

  for (const node of nodes) {
    const valid = validateFunc(node.data);

    if (valid) {
      result.schemaValidCount++;
    } else {
      result.schemaErrorCount++;
      result.schemaErrors.push({
        file: node.label,
        errors: validateFunc.errors || [],
      });
    }
  }

  // Build index of all node labels (without .md extension)
  const nodeIndex = new Map(
    nodes.map(n => [n.label.replace(/\.md$/, ''), n])
  );

  function extractWikilinkFilename(wikilink: string): string {
    const cleaned = wikilink.replace(/^"|"$/g, '');
    return cleaned.slice(2, -2);
  }

  for (const node of nodes) {
    const parent = node.data.parent as string | undefined;
    if (!parent) continue;

    const parentFile = extractWikilinkFilename(parent);
    if (!nodeIndex.has(parentFile)) {
      result.refErrors.push({
        file: node.label,
        parent: parent,
        error: `Parent node "${parentFile}" not found`,
      });
    }
  }

  // Report
  console.log(`\n🔍 OST Validation Results`);
  console.log(`━`.repeat(50));
  console.log(`✅ Valid: ${result.schemaValidCount}`);
  console.log(`❌ Schema Errors: ${result.schemaErrorCount}`);
  console.log(`🔗 Reference Errors: ${result.refErrors.length}`);
  console.log(`⏭ Skipped (no frontmatter): ${result.skipped.length}`);
  console.log(`📄 Non-OST (no type field): ${result.nonOst.length}`);

  if (result.skipped.length > 0) {
    console.log(`\n⏭ Skipped files (no frontmatter):`);
    result.skipped.forEach(f => console.log(`   ${f}`));
  }

  if (result.nonOst.length > 0) {
    console.log(`\n📄 Non-OST files (no type field):`);
    result.nonOst.forEach(f => console.log(`   ${f}`));
  }

  if (result.schemaErrors.length > 0) {
    console.log(`\n❌ Schema validation errors:`);
    result.schemaErrors.forEach(({ file, errors }) => {
      console.log(`\n   ${file}:`);
      errors.forEach((err: any) => {
        console.log(`      ${err.instancePath || 'root'}: ${err.message}`);
      });
    });
  }

  if (result.refErrors.length > 0) {
    console.log(`\n🔗 Reference errors (dangling parent links):`);
    result.refErrors.forEach(({ file, parent, error }) => {
      console.log(`   ${file}: parent ${parent} → ${error}`);
    });
  }

  console.log(`\n`);

  if (result.schemaErrorCount > 0 || result.refErrors.length > 0) {
    process.exit(1);
  }
}
