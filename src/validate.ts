import { glob } from 'glob';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import matter from 'gray-matter';
import Ajv from 'ajv';

interface Node {
  filepath: string;
  filename: string;
  data: any;
  content: string;
}

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

  const files = await glob('**/*.md', { cwd: directory, absolute: false });
  const nodes: Node[] = [];
  const skipped: string[] = [];
  const nonOst: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(directory, file), 'utf-8');
    const parsed = matter(content);

    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      skipped.push(file);
      continue;
    }

    if (!parsed.data.type) {
      nonOst.push(file);
      continue;
    }

    nodes.push({
      filepath: join(directory, file),
      filename: file,
      data: { title: basename(file, '.md'), ...parsed.data },
      content: parsed.content,
    });
  }

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
        file: node.filename,
        errors: validateFunc.errors || [],
      });
    }
  }

  // Build index of all node filenames (without .md extension)
  const nodeIndex = new Map<string, Node>();
  for (const node of nodes) {
    const name = node.filename.replace(/\.md$/, '');
    nodeIndex.set(name, node);
  }

  function extractWikilinkFilename(wikilink: string): string {
    // Schema already validates format, so we can safely extract
    // Handle both "[[Name]]" and [[Name]] formats
    const cleaned = wikilink.replace(/^"|"$/g, ''); // Remove surrounding quotes if present
    return cleaned.slice(2, -2); // Remove [[ and ]]
  }

  for (const node of nodes) {
    const parent = node.data.parent as string | undefined;
    if (!parent) continue;

    const parentFile = extractWikilinkFilename(parent);
    if (!nodeIndex.has(parentFile)) {
      result.refErrors.push({
        file: node.filename,
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

  // Exit code 1 if schema or reference errors exist
  if (result.schemaErrorCount > 0 || result.refErrors.length > 0) {
    process.exit(1);
  }
}
