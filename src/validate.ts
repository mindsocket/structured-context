import { readFileSync, statSync } from 'node:fs';
import Ajv, { type ErrorObject } from 'ajv';
import { readOstPage } from './read-ost-page.js';
import { readSpace } from './read-space.js';
import type { OstNode } from './types.js';

interface ValidationResult {
  schemaValidCount: number;
  schemaErrorCount: number;
  schemaErrors: Array<{ file: string; errors: ErrorObject[] }>;
  refErrors: Array<{ file: string; parent: string; error: string }>;
  skipped: string[];
  nonOst: string[];
}

/**
 * Convert a node label to the key used in the reference index.
 *
 * Handles both plain file labels and compound embedded-node labels:
 *   "Personal Vision.md"             → "Personal Vision"
 *   "Personal Vision.md#Our Mission" → "Personal Vision#Our Mission"
 *   "Our Mission"                    → "Our Mission"  (standalone / ost_on_a_page)
 */
export function labelToKey(label: string): string {
  const hashIdx = label.indexOf('#');
  if (hashIdx >= 0) {
    return label.slice(0, hashIdx).replace(/\.md$/, '') + label.slice(hashIdx);
  }
  return label.replace(/\.md$/, '');
}

/**
 * Extract the lookup key from a wikilink string such as:
 *   [[Personal Vision]]                → "Personal Vision"
 *   [[Personal Vision#Our Mission]]    → "Personal Vision#Our Mission"
 *   [[Personal Vision#^ourmission]]    → "Personal Vision#^ourmission"
 */
function wikilinkToKey(wikilink: string): string {
  // Strip surrounding quotes if present (YAML sometimes keeps them)
  const cleaned = wikilink.replace(/^"|"$/g, '');
  return cleaned.slice(2, -2);
}

export async function validate(path: string, options: { schema: string }): Promise<void> {
  const schema = JSON.parse(readFileSync(options.schema, 'utf-8'));
  const ajv = new Ajv();
  const validateFunc = ajv.compile(schema);

  let nodes: OstNode[];
  let skipped: string[] = [];
  let nonOst: string[] = [];

  if (statSync(path).isFile()) {
    ({ nodes } = readOstPage(path));
  } else {
    ({ nodes, skipped, nonOst } = await readSpace(path));
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
        file: node.label,
        errors: validateFunc.errors || [],
      });
    }
  }

  // Build index: primary key (title / filename#title) + anchor-based keys.
  const nodeIndex = new Map<string, OstNode>();
  for (const n of nodes) {
    const key = labelToKey(n.label);
    nodeIndex.set(key, n);

    // Also index by anchor so [[File#^anchorname]] resolves correctly.
    if (n.data.anchor) {
      const hashIdx = n.label.indexOf('#');
      const fileKey = hashIdx >= 0 ? n.label.slice(0, hashIdx).replace(/\.md$/, '') : n.label.replace(/\.md$/, '');
      nodeIndex.set(`${fileKey}#^${n.data.anchor}`, n);
    }
  }

  for (const node of nodes) {
    const parent = node.data.parent as string | undefined;
    if (!parent) continue;

    const parentKey = wikilinkToKey(parent);
    if (!nodeIndex.has(parentKey)) {
      result.refErrors.push({
        file: node.label,
        parent: parent,
        error: `Parent node "${parentKey}" not found`,
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
    for (const f of result.skipped) console.log(`   ${f}`);
  }

  if (result.nonOst.length > 0) {
    console.log(`\n📄 Non-OST files (no type field):`);
    for (const f of result.nonOst) console.log(`   ${f}`);
  }

  if (result.schemaErrors.length > 0) {
    console.log(`\n❌ Schema validation errors:`);
    result.schemaErrors.forEach(({ file, errors }) => {
      console.log(`\n   ${file}:`);
      errors.forEach((err: ErrorObject) => {
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
