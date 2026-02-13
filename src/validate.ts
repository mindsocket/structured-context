import { glob } from 'glob';
import { readFileSync } from 'fs';
import matter from 'gray-matter';
import Ajv from 'ajv';
import { join } from 'path';

interface Node {
  filepath: string;
  filename: string;
  data: any;
  content: string;
}

interface ValidationResult {
  validCount: number;
  errorCount: number;
  errors: Array<{ file: string; errors: any[] }>;
  skipped: string[];
  nonOst: string[];
}

export async function validate(directory: string, options: { schema?: string }) {
  const schemaPath = options.schema || '/Users/roger/Documents/Vaulty/Opportunity Solution Tree/ost-schema.json';
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
      data: parsed.data,
      content: parsed.content,
    });
  }

  const result: ValidationResult = {
    validCount: 0,
    errorCount: 0,
    errors: [],
    skipped,
    nonOst,
  };

  for (const node of nodes) {
    const valid = validateFunc(node.data);

    if (valid) {
      result.validCount++;
    } else {
      result.errorCount++;
      result.errors.push({
        file: node.filename,
        errors: validateFunc.errors || [],
      });
    }
  }

  // Report
  console.log(`\n🔍 OST Validation Results`);
  console.log(`━`.repeat(50));
  console.log(`✅ Valid: ${result.validCount}`);
  console.log(`❌ Errors: ${result.errorCount}`);
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

  if (result.errors.length > 0) {
    console.log(`\n❌ Validation errors:`);
    result.errors.forEach(({ file, errors }) => {
      console.log(`\n   ${file}:`);
      errors.forEach((err: any) => {
        console.log(`      ${err.instancePath || 'root'}: ${err.message}`);
      });
    });
  }

  console.log(`\n`);

  // Exit code 1 if errors
  if (result.errorCount > 0) {
    process.exit(1);
  }
}
