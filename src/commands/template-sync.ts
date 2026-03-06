import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { AnySchemaObject, SchemaObject } from 'ajv';
import { glob } from 'glob';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { buildSchemaRegistry, loadSchema, resolveRef } from '../schema';

interface TypeVariant {
  required: string[];
  optional: string[];
  properties: Record<string, AnySchemaObject>;
  example: Record<string, string | number | boolean>;
  description: string | undefined;
}

// Fields derived from the filesystem — present at validation time but not written to frontmatter
const DERIVED_FIELDS = new Set(['title', 'content']);

// Merge properties from allOf sub-schemas into a single properties map
function mergeAllOfProperties(
  variant: AnySchemaObject,
  schema: SchemaObject,
  registry: Map<string, AnySchemaObject>,
): Record<string, AnySchemaObject> {
  const merged: Record<string, AnySchemaObject> = {};
  const { allOf, properties: variantProps } = variant as {
    allOf?: AnySchemaObject[];
    properties?: Record<string, AnySchemaObject>;
  };
  for (const sub of allOf ?? []) {
    const resolved = resolveRef(sub, schema, registry);
    const { properties } = (resolved as { properties?: Record<string, AnySchemaObject> }) ?? {};
    Object.assign(merged, properties ?? {});
  }
  Object.assign(merged, variantProps ?? {});
  return merged;
}

function enumPlaceholder(def: AnySchemaObject): string {
  return (def as { enum?: string[] }).enum?.join('|') ?? '';
}

function withEnumPlaceholders(
  example: Record<string, string | number | boolean>,
  properties: Record<string, AnySchemaObject>,
  schema: SchemaObject,
  registry: Map<string, AnySchemaObject>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(example).map(([key, value]) => {
      const def = resolveRef(properties[key], schema, registry);
      return def && 'enum' in def ? [key, enumPlaceholder(def)] : [key, value];
    }),
  );
}

function commentedHint(
  fieldName: string,
  propDef: AnySchemaObject | undefined,
  schema: SchemaObject,
  registry: Map<string, AnySchemaObject>,
): string {
  const def = resolveRef(propDef, schema, registry);
  let value: string;
  const defTyped = def as
    | {
        enum?: string[];
        type?: string;
        minimum?: number;
        maximum?: number;
        description?: string;
      }
    | undefined;
  if (defTyped?.enum) {
    value = enumPlaceholder(defTyped);
  } else if (defTyped?.type === 'integer') {
    value = String(Math.ceil(((defTyped.minimum ?? 1) + (defTyped.maximum ?? 5)) / 2));
  } else if (defTyped?.type === 'array') {
    value = '[]';
  } else {
    value = '""';
  }
  const description = defTyped?.description;
  return `# ${fieldName}: ${value}${description ? `  # ${description}` : ''}`;
}

function getTypeVariants(schema: SchemaObject, registry: Map<string, AnySchemaObject>): Map<string, TypeVariant> {
  const map = new Map<string, TypeVariant>();
  for (const variant of schema.oneOf) {
    const typeName = variant.properties?.type?.const as string;
    if (!typeName || typeName === 'dashboard' || typeName === 'ost_on_a_page') continue;
    if (!variant.examples?.[0]) continue;

    const required = (variant.required as string[]).filter((k: string) => k !== 'type' && !DERIVED_FIELDS.has(k));
    const allProperties = Object.fromEntries(
      Object.entries(mergeAllOfProperties(variant, schema, registry)).filter(
        ([k]) => k !== 'type' && !DERIVED_FIELDS.has(k),
      ),
    );
    const optional = Object.keys(allProperties).filter((k) => !required.includes(k));
    const example = variant.examples[0] as Record<string, string | number | boolean>;
    const description = (variant as { description?: string }).description;

    map.set(typeName, {
      required,
      optional,
      properties: allProperties,
      example,
      description,
    });
  }
  return map;
}

export async function templateSync(templateDir: string, options: { schema: string; dryRun?: boolean }) {
  const schema = loadSchema(options.schema);

  // Build schema registry for cross-file $ref resolution
  const schemaDir = dirname(options.schema);
  const registry = buildSchemaRegistry(schemaDir, basename(options.schema));

  const typeVariants = getTypeVariants(schema, registry);

  const files = await glob('*.md', { cwd: templateDir, absolute: true });
  if (files.length === 0) {
    console.log(`No template files found in ${templateDir}`);
    return;
  }

  const dryRun = options.dryRun ?? false;
  let filesModified = 0;

  console.log(`\n🔄 Template Sync`);
  console.log('━'.repeat(50));
  if (dryRun) console.log('(dry run — no files will be modified)\n');

  for (const file of files.sort()) {
    const filename = file.split('/').pop()!;
    const content = readFileSync(file, 'utf-8');

    const fmMatch = content.match(/^---\n[\s\S]*?\n---/);
    if (!fmMatch) {
      console.log(`⚠  ${filename}: no frontmatter, skipping`);
      continue;
    }
    const body = content.slice(fmMatch[0].length);

    const parsed = matter(content);
    const nodeType = parsed.data.type as string | undefined;
    if (!nodeType) {
      console.log(`⚠  ${filename}: no type field, skipping`);
      continue;
    }

    const variant = typeVariants.get(nodeType);
    if (!variant) {
      console.log(`⚠  ${filename}: no schema example for type "${nodeType}", skipping`);
      continue;
    }

    const { example, optional, properties, description } = variant;
    const exampleKeys = new Set(Object.keys(example));

    const exampleWithPlaceholders = withEnumPlaceholders(example, properties, schema, registry);
    let frontmatterYaml = (yaml.dump(exampleWithPlaceholders, { lineWidth: -1 }) as string).trim();

    // Append property descriptions as comments
    const lines = frontmatterYaml.split('\n');
    const commentedLines = lines.map((line) => {
      const match = line.match(/^([^:]+):/);
      if (match) {
        const key = match[1].trim();
        const propDef = resolveRef(properties[key], schema, registry);
        const propDescription = (propDef as { description?: string })?.description;
        if (propDescription) {
          return `${line}  # ${propDescription}`;
        }
      }
      return line;
    });

    frontmatterYaml = `# Template for a \`${nodeType}\` from schema: ${schema.title}\n${description ? `# ${description}\n` : ''}${commentedLines.join('\n')}`;

    const hints = optional
      .filter((field) => !exampleKeys.has(field))
      .map((field) => commentedHint(field, properties[field], schema, registry));

    const newFrontmatter = hints.length > 0 ? `${frontmatterYaml}\n${hints.join('\n')}` : frontmatterYaml;

    const newContent = `---\n${newFrontmatter}\n---${body}`;

    if (newContent === content) {
      console.log(`✓  ${filename}`);
    } else {
      console.log(`📝 ${filename}: updated`);
      if (dryRun) {
        // Simple line-based diff for preview
        const oldLines = content.split('\n');
        const newLines = newContent.split('\n');
        const maxLines = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLines; i++) {
          const isFmEnd = oldLines[i] === '---' && i > 0;
          if (oldLines[i] !== newLines[i]) {
            if (i < oldLines.length) console.log(`\x1b[31m- ${oldLines[i] || ''}\x1b[0m`);
            if (i < newLines.length) console.log(`\x1b[32m+ ${newLines[i] || ''}\x1b[0m`);
          } else if (i < 15) {
             // Show some context but not too much
             console.log(`  ${oldLines[i]}`);
          }
          if (isFmEnd) {
            if (i + 1 < maxLines && oldLines[i+1] !== newLines[i+1]) {
               // continue if next line is different
            } else {
               break;
            }
          }
        }
        console.log('');
      }
      if (!dryRun) {
        writeFileSync(file, newContent);
        filesModified++;
      }
    }
  }

  console.log(`\n${'━'.repeat(50)}`);
  if (dryRun) {
    console.log('No files modified (dry run)\n');
  } else {
    console.log(`${filesModified} file(s) updated\n`);
  }
}
