import { statSync } from 'node:fs';
import type { ErrorObject } from 'ajv';
import { readSpaceDirectory } from '../read-space-directory';
import { readSpaceOnAPage } from '../read-space-on-a-page';
import { buildTargetIndex, wikilinkToTarget } from '../resolve-links';
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
    ruleViolations: [],
    hierarchyViolations: [],
    skipped,
    nonSpace: nonSpace,
  };

  // Load metadata early — needed for levels-based ref validation
  const metadata = loadMetadata(options.schema);

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

  // Detect duplicate node keys (titles)
  const titleToFiles = new Map<string, string[]>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    if (!titleToFiles.has(title)) {
      titleToFiles.set(title, []);
    }
    titleToFiles.get(title)!.push(node.label);
  }

  for (const [title, files] of titleToFiles) {
    if (files.length > 1) {
      result.duplicateErrors.push({ title, files });
    }
  }

  // Build targetIndex for link validation
  const linkTargetIndex = buildTargetIndex(nodes);
  const levels = metadata.hierarchy?.levels ?? [];

  // Validate edge field references for each hierarchy level
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i]!;
    const parentLevel = levels[i - 1]!;

    // Determine which nodes to check based on who has the field
    const nodesToCheck =
      level.fieldOn === 'parent'
        ? nodes.filter((n) => n.resolvedType === parentLevel.type)
        : nodes.filter((n) => n.resolvedType === level.type);

    for (const node of nodesToCheck) {
      const rawField = node.schemaData[level.field];
      if (rawField === undefined || rawField === null) continue;

      if (level.multiple) {
        if (!Array.isArray(rawField)) {
          result.refErrors.push({
            file: node.label,
            parent: String(rawField),
            error: `Field "${level.field}" must be an array of wikilinks, got ${typeof rawField}`,
          });
          continue;
        }
        for (const ref of rawField) {
          if (typeof ref !== 'string') continue;
          const target = wikilinkToTarget(ref);
          const resolved = linkTargetIndex.get(target);
          if (resolved === undefined) {
            result.refErrors.push({
              file: node.label,
              parent: ref,
              error: `Link target "${target}" in field "${level.field}" not found`,
            });
          } else if (resolved === null) {
            result.refErrors.push({
              file: node.label,
              parent: ref,
              error: `Link target "${target}" in field "${level.field}" is ambiguous (matches multiple nodes)`,
            });
          }
        }
      } else {
        if (typeof rawField !== 'string') {
          result.refErrors.push({
            file: node.label,
            parent: String(rawField),
            error: `Field "${level.field}" must be a wikilink string, got ${typeof rawField}`,
          });
          continue;
        }
        const target = wikilinkToTarget(rawField);
        const resolved = linkTargetIndex.get(target);
        if (resolved === undefined) {
          result.refErrors.push({
            file: node.label,
            parent: rawField,
            error: `Link target "${target}" in field "${level.field}" not found`,
          });
        } else if (resolved === null) {
          result.refErrors.push({
            file: node.label,
            parent: rawField,
            error: `Link target "${target}" in field "${level.field}" is ambiguous (matches multiple nodes)`,
          });
        }
      }
    }
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
    console.log(`\n🔗 Reference errors (dangling links):`);
    result.refErrors.forEach(({ file, parent, error }) => {
      console.log(`   ${file}: ${parent} → ${error}`);
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
    result.ruleViolations.length > 0 ||
    result.hierarchyViolations.length > 0
  ) {
    process.exit(1);
  }
}
