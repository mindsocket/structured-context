import { statSync } from 'node:fs';
import type { ErrorObject } from 'ajv';
import { readSpaceDirectory } from '../read-space-directory';
import { readSpaceOnAPage } from '../read-space-on-a-page';
import { wikilinkToTarget } from '../resolve-links';
import { createValidator, loadMetadata } from '../schema';
import type { HierarchyViolation, RuleViolation, SpaceNode } from '../types';
import { validateHierarchy } from '../validate-hierarchy';
import { validateRules } from '../validate-rules';

interface ValidationResult {
  validCount: number;
  nodeErrorCount: number;
  nodeErrors: Array<{ file: string; errors: ErrorObject[] }>;
  refErrors: Array<{ file: string; parent: string; error: string }>;
  duplicateErrors: Array<{ title: string; files: string[] }>;
  configErrors: string[];
  ruleViolations: RuleViolation[];
  hierarchyViolations: HierarchyViolation[];
  skipped: string[];
  nonSpace: string[];
}

export async function validate(path: string, options: { schema: string; templateDir?: string }): Promise<void> {
  const validateFunc = createValidator(options.schema);

  let nodes: SpaceNode[];
  let skipped: string[] = [];
  let nonSpace: string[] = [];

  if (statSync(path).isFile()) {
    ({ nodes } = readSpaceOnAPage(path, options.schema));
  } else {
    ({
      nodes,
      skipped,
      nonSpace: nonSpace,
    } = await readSpaceDirectory(path, {
      schemaPath: options.schema,
      templateDir: options.templateDir,
    }));
  }

  const result: ValidationResult = {
    validCount: 0,
    nodeErrorCount: 0,
    nodeErrors: [],
    refErrors: [],
    duplicateErrors: [],
    configErrors: [],
    ruleViolations: [],
    hierarchyViolations: [],
    skipped,
    nonSpace: nonSpace,
  };

  for (const node of nodes) {
    const valid = validateFunc(node.schemaData);

    if (valid) {
      result.validCount++;
    } else {
      result.nodeErrorCount++;
      result.nodeErrors.push({
        file: node.label,
        errors: validateFunc.errors || [],
      });
    }
  }

  // Detect duplicate node keys (titles) and build nodeIndex for parent ref validation
  const titleToFiles = new Map<string, string[]>();
  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    if (!titleToFiles.has(title)) {
      titleToFiles.set(title, []);
    }
    titleToFiles.get(title)!.push(node.label);
    nodeIndex.set(title, node);
  }

  for (const [title, files] of titleToFiles) {
    if (files.length > 1) {
      result.duplicateErrors.push({ title, files });
    }
  }

  for (const node of nodes) {
    const parent = node.schemaData.parent;
    if (typeof parent !== 'string') {
      if (parent) {
        result.refErrors.push({
          file: node.label,
          parent: String(parent),
          error: `Parent field must be a wikilink string, got ${typeof parent}`,
        });
      }
      continue;
    }

    const parentKey = node.resolvedParent;
    if (!parentKey) {
      result.refErrors.push({
        file: node.label,
        parent: parent,
        error: `Parent link target "${wikilinkToTarget(parent)}" not found`,
      });
      continue;
    }

    if (!nodeIndex.has(parentKey)) {
      result.refErrors.push({
        file: node.label,
        parent: parent,
        error: `Parent node "${parentKey}" not found`,
      });
    }
  }

  // Load and execute hierarchy validation if schema defines hierarchy
  const metadata = loadMetadata(options.schema);

  // Validate schema metadata configuration
  const badSelfRefTypes = (metadata.allowSelfRef ?? []).filter((t) => !metadata.hierarchy.includes(t));
  for (const t of badSelfRefTypes) {
    result.configErrors.push(`allowSelfRef contains "${t}" which is not in the hierarchy`);
  }

  result.hierarchyViolations = validateHierarchy(nodes, metadata);

  // Load and execute rules validation if schema defines rules
  if (metadata.rules) {
    result.ruleViolations = await validateRules(nodes, metadata.rules);
  }

  // Report
  console.log(`\n🔍 Space Validation Results`);
  console.log(`━`.repeat(50));
  console.log(`✅ Valid: ${result.validCount}`);
  console.log(`❌ Node Errors: ${result.nodeErrorCount}`);
  console.log(`🔗 Reference Errors: ${result.refErrors.length}`);
  console.log(`🔁 Duplicate Keys: ${result.duplicateErrors.length}`);
  console.log(`⚙️ Config Errors: ${result.configErrors.length}`);
  console.log(`📋 Rule Violations: ${result.ruleViolations.length}`);
  console.log(`🏗️ Hierarchy Violations: ${result.hierarchyViolations.length}`);
  console.log(`⏭ Skipped (no frontmatter): ${result.skipped.length}`);
  console.log(`📄 Non-space (no type field): ${result.nonSpace.length}`);

  if (result.skipped.length > 0) {
    console.log(`\n⏭ Skipped files (no frontmatter):`);
    for (const f of result.skipped) console.log(`   ${f}`);
  }

  if (result.nonSpace.length > 0) {
    console.log(`\n📄 Non-space files (no type field):`);
    for (const f of result.nonSpace) console.log(`   ${f}`);
  }

  if (result.nodeErrors.length > 0) {
    console.log(`\n❌ Node errors:`);
    result.nodeErrors.forEach(({ file, errors }) => {
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

  if (result.duplicateErrors.length > 0) {
    console.log(`\n🔁 Duplicate node keys (same title in multiple files):`);
    result.duplicateErrors.forEach(({ title, files }) => {
      console.log(`   "${title}":`);
      for (const f of files) {
        console.log(`      ${f}`);
      }
    });
  }

  if (result.configErrors.length > 0) {
    console.log(`\n⚙️  Config errors:`);
    for (const e of result.configErrors) {
      console.log(`   ${e}`);
    }
  }

  if (result.ruleViolations.length > 0) {
    console.log(`\n📋 Rule violations:`);

    // Group by category
    const byCategory = new Map<string, RuleViolation[]>();
    for (const v of result.ruleViolations) {
      if (!byCategory.has(v.category)) {
        byCategory.set(v.category, []);
      }
      byCategory.get(v.category)!.push(v);
    }

    // Report each category
    for (const [category, violations] of byCategory) {
      console.log(`  ${category.toUpperCase()} (${violations.length}):`);
      for (const v of violations) {
        console.log(`    ${v.file ? `${v.file}: ` : ''}${v.description}`);
      }
    }
  }

  if (result.hierarchyViolations.length > 0) {
    console.log(`\n🏗️  Hierarchy violations:`);
    for (const v of result.hierarchyViolations) {
      console.log(`   ${v.file}: ${v.description}`);
    }
  }

  console.log(`\n`);

  if (
    result.nodeErrorCount > 0 ||
    result.refErrors.length > 0 ||
    result.duplicateErrors.length > 0 ||
    result.configErrors.length > 0 ||
    result.ruleViolations.length > 0 ||
    result.hierarchyViolations.length > 0
  ) {
    process.exit(1);
  }
}
