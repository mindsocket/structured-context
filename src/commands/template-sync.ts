import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnySchemaObject } from 'ajv';
import { Glob } from 'bun';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { invertFieldMap } from '../plugins/markdown/util';
import { loadSchema } from '../schema/schema';
import { mergeVariantProperties, resolveRef } from '../schema/schema-refs';
import type { HierarchyLevel, Relationship, SchemaWithMetadata } from '../types';

export interface TypeVariant {
  required: string[];
  optional: string[];
  properties: Record<string, AnySchemaObject>;
  example: Record<string, string | number | boolean>;
  description: string | undefined;
  relationships: Relationship[];
  /** Hierarchy child levels where this type is the parent and the level has templateFormat/matchers. */
  hierarchyChildren: HierarchyLevel[];
}

// Fields derived from the filesystem — present at validation time but not written to frontmatter
const DERIVED_FIELDS = new Set(['title', 'content']);

function enumPlaceholder(def: AnySchemaObject): string {
  return (def as { enum?: string[] }).enum?.join('|') ?? '';
}

function withEnumPlaceholders(
  example: Record<string, string | number | boolean>,
  properties: Record<string, AnySchemaObject>,
  schema: SchemaWithMetadata,
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
  schema: SchemaWithMetadata,
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

export function getTypeVariants(
  schema: SchemaWithMetadata,
  registry: Map<string, AnySchemaObject>,
): Map<string, TypeVariant> {
  const map = new Map<string, TypeVariant>();
  for (const variant of schema.oneOf) {
    const typeName = variant.properties?.type?.const as string;
    if (!typeName || typeName === 'dashboard' || typeName === 'ost_on_a_page') continue;
    if (!variant.examples?.[0]) continue;

    const required = (variant.required as string[]).filter((k: string) => k !== 'type' && !DERIVED_FIELDS.has(k));
    const allProperties = Object.fromEntries(
      Object.entries(mergeVariantProperties(variant, schema, registry).properties).filter(
        ([k]) => k !== 'type' && !DERIVED_FIELDS.has(k),
      ),
    );
    const optional = Object.keys(allProperties).filter((k) => !required.includes(k));
    const example = variant.examples[0] as Record<string, string | number | boolean>;
    const description = (variant as { description?: string }).description;

    const allRelationships = schema.metadata.relationships ?? [];
    const typeRelationships = allRelationships.filter((rel) => rel.parent === typeName);

    const allLevels = schema.metadata.hierarchy?.levels ?? [];
    const typeIdx = allLevels.findIndex((l) => l.type === typeName);
    const hierarchyChildren: HierarchyLevel[] =
      typeIdx !== -1 && typeIdx < allLevels.length - 1
        ? allLevels.slice(typeIdx + 1).filter((l) => l.templateFormat && l.matchers)
        : [];

    map.set(typeName, {
      required,
      optional,
      properties: allProperties,
      example,
      description,
      relationships: typeRelationships,
      hierarchyChildren,
    });
  }
  return map;
}

export function generateNewContent(
  nodeType: string,
  variant: TypeVariant,
  schema: SchemaWithMetadata,
  registry: Map<string, AnySchemaObject>,
  allVariants: Map<string, TypeVariant>,
  body = '\nTODO\n',
  fieldMap: Record<string, string> = {},
): string {
  const { example, optional, properties, description } = variant;
  const exampleKeys = new Set(Object.keys(example));

  // fieldMap is file→canonical; invert once to get canonical→file for template output
  const canonicalToFile = invertFieldMap(fieldMap);
  const toFileKey = (k: string) => canonicalToFile[k] ?? k;
  const toCanonicalKey = (k: string) => fieldMap[k] ?? k;
  const exampleWithPlaceholders = withEnumPlaceholders(example, properties, schema, registry);
  const remappedExample = Object.fromEntries(
    Object.entries(exampleWithPlaceholders).map(([k, v]) => [toFileKey(k), v]),
  );
  let frontmatterYaml = (yaml.dump(remappedExample, { lineWidth: -1 }) as string).trim();

  // Append property descriptions as comments
  // YAML lines use file field names; look up properties using canonical key.
  const lines = frontmatterYaml.split('\n');
  const commentedLines = lines.map((line) => {
    const match = line.match(/^([^:]+):/);
    if (match) {
      const fileKey = match[1]!.trim();
      const canonicalKey = toCanonicalKey(fileKey);
      const propDef = resolveRef(properties[canonicalKey], schema, registry);
      const propDescription = (propDef as { description?: string })?.description;
      if (propDescription) {
        return `${line}  # ${propDescription}`;
      }
    }
    return line;
  });

  frontmatterYaml = `# Template for a \`${nodeType}\`${schema.title ? ` from schema: ${schema.title}` : ''}\n${
    description ? `# ${description}\n` : ''
  }${commentedLines.join('\n')}`;

  const hints = optional
    .filter((field) => !exampleKeys.has(field))
    .map((field) => commentedHint(toFileKey(field), properties[field], schema, registry));

  const newFrontmatter = hints.length > 0 ? `${frontmatterYaml}\n${hints.join('\n')}` : frontmatterYaml;

  let relationshipStubs = '';
  for (const rel of variant.relationships) {
    const matcher = rel.matchers?.[0] || rel.type;
    if (body.includes(`### ${matcher}`)) {
      continue;
    }

    const childVariant = allVariants.get(rel.type);
    const childExample = childVariant?.example || {};

    if (rel.templateFormat === 'table' && rel.embeddedTemplateFields) {
      const header = `| ${rel.embeddedTemplateFields.join(' | ')} |`;
      const sep = `| ${rel.embeddedTemplateFields.map(() => '---|').join('')}`;
      const exampleValues = rel.embeddedTemplateFields.map((field) => {
        const val = childExample[field];
        return val !== undefined ? String(val) : ' ';
      });
      const exampleRow = `| ${exampleValues.join(' | ')} |`;
      relationshipStubs += `\n### ${matcher}\n\n${header}\n${sep}\n${exampleRow}\n`;
    } else if (rel.templateFormat === 'heading') {
      let stub = `\n### ${matcher}\n\n`;
      if (childVariant) {
        // Include inline fields from example if it's a heading
        const fields = Object.entries(childExample)
          .filter(([k]) => k !== 'type' && k !== 'title' && k !== 'parent')
          .map(([k, v]) => `[${k}:: ${v}]`)
          .join(' ');
        stub += `${fields}${fields ? ' ' : ''}TODO: Describe ${rel.type}\n`;
      } else {
        stub += `TODO: Describe ${rel.type}\n`;
      }
      relationshipStubs += stub;
    } else if (rel.templateFormat === 'list') {
      let stub = `\n### ${matcher}\n\n- [type:: ${rel.type}] `;
      if (childVariant) {
        const fields = Object.entries(childExample)
          .filter(([k]) => k !== 'type' && k !== 'title' && k !== 'parent')
          .map(([k, v]) => `[${k}:: ${v}]`)
          .join(' ');
        stub += `${fields}${fields ? ' ' : ''}TODO`;
      } else {
        stub += 'TODO';
      }
      relationshipStubs += `${stub}\n`;
    }
  }

  for (const level of variant.hierarchyChildren) {
    const matcher = level.matchers?.[0] || level.type;
    if (body.includes(`### ${matcher}`)) {
      continue;
    }

    const childVariant = allVariants.get(level.type);
    const childExample = childVariant?.example || {};

    if (level.templateFormat === 'table' && level.embeddedTemplateFields) {
      const header = `| ${level.embeddedTemplateFields.join(' | ')} |`;
      const sep = `| ${level.embeddedTemplateFields.map(() => '---|').join('')}`;
      const exampleValues = level.embeddedTemplateFields.map((field) => {
        const val = childExample[field];
        return val !== undefined ? String(val) : ' ';
      });
      const exampleRow = `| ${exampleValues.join(' | ')} |`;
      relationshipStubs += `\n### ${matcher}\n\n${header}\n${sep}\n${exampleRow}\n`;
    } else if (level.templateFormat === 'list') {
      let stub = `\n### ${matcher}\n\n- [type:: ${level.type}] `;
      if (childVariant) {
        const fields = Object.entries(childExample)
          .filter(([k]) => k !== 'type' && k !== 'title' && k !== 'parent')
          .map(([k, v]) => `[${k}:: ${v}]`)
          .join(' ');
        stub += `${fields}${fields ? ' ' : ''}TODO`;
      } else {
        stub += 'TODO';
      }
      relationshipStubs += `${stub}\n`;
    }
  }

  const finalBody = relationshipStubs ? `\n${relationshipStubs}${body.trimStart()}` : body;

  return `---\n${newFrontmatter}\n---${finalBody}`;
}

export async function templateSync(
  templateDir: string,
  options: {
    schema: string;
    templatePrefix: string;
    dryRun?: boolean;
    createMissing?: boolean;
    fieldMap?: Record<string, string>;
  },
) {
  const { schema, registry } = loadSchema(options.schema);
  const templatePrefix = options.templatePrefix;
  const fieldMap = options.fieldMap ?? {};

  const typeVariants = getTypeVariants(schema, registry);
  const matchedTypes = new Set<string>();

  const files = await Array.fromAsync(new Glob('*.md').scan({ cwd: templateDir, absolute: true }));
  const dryRun = options.dryRun ?? false;
  let filesModified = 0;
  let filesCreated = 0;

  console.log(`\n🔄 Template Sync`);
  console.log('━'.repeat(50));
  if (dryRun) console.log('(dry run — no files will be modified)\n');

  for (const file of files.sort()) {
    const filename = file.split('/').pop()!;
    const content = readFileSync(file, 'utf-8');

    const fmMatch = content.match(/^---\n[\s\S]*?\n---/);
    if (!fmMatch) {
      continue;
    }
    const body = content.slice(fmMatch[0].length);

    const parsed = matter(content);
    const nodeType = parsed.data.type as string | undefined;
    if (!nodeType) {
      continue;
    }

    const variant = typeVariants.get(nodeType);
    if (!variant) {
      continue;
    }

    matchedTypes.add(nodeType);

    // Warning if filename doesn't match convention
    const expectedFilename = `${templatePrefix}${nodeType}.md`;
    if (filename !== expectedFilename) {
      console.log(`⚠  ${filename}: type "${nodeType}" should be named "${expectedFilename}"`);
    }

    const newContent = generateNewContent(nodeType, variant, schema, registry, typeVariants, body, fieldMap);

    if (newContent === content) {
      console.log(`✓  ${filename}`);
    } else {
      console.log(`📝 ${filename}: updated`);
      if (dryRun) {
        // Simple line-based diff for preview
        const oldLines = content.split('\n');
        const newLines = newContent.split('\n');
        const maxLines = Math.max(oldLines.length, newLines.length);
        let inFrontmatter = true;
        for (let i = 0; i < maxLines; i++) {
          const isFmEnd = inFrontmatter && oldLines[i] === '---' && i > 0;
          if (isFmEnd) inFrontmatter = false;

          if (oldLines[i] !== newLines[i]) {
            if (i < oldLines.length) console.log(`\x1b[31m- ${oldLines[i] || ''}\x1b[0m`);
            if (i < newLines.length) console.log(`\x1b[32m+ ${newLines[i] || ''}\x1b[0m`);
          } else if (i < 15) {
            // Show some context but not too much
            console.log(`  ${oldLines[i]}`);
          }

          if (isFmEnd) {
            // After frontmatter ends, only continue if next line differs
            if (i + 1 >= maxLines || oldLines[i + 1] === newLines[i + 1]) {
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

  // Handle missing types
  const missingTypes = Array.from(typeVariants.keys()).filter((t) => !matchedTypes.has(t));
  if (missingTypes.length > 0) {
    console.log(`\nMissing templates for: ${missingTypes.join(', ')}`);
    if (options.createMissing) {
      for (const type of missingTypes) {
        const variant = typeVariants.get(type)!;
        const newContent = generateNewContent(type, variant, schema, registry, typeVariants, undefined, fieldMap);
        const newFilename = `${templatePrefix}${type}.md`;
        const newFilePath = join(templateDir, newFilename);

        console.log(`✨ ${newFilename}: creating`);
        if (!dryRun) {
          writeFileSync(newFilePath, newContent);
          filesCreated++;
        }
      }
    } else {
      console.log('(use --create-missing to scaffold them)');
    }
  }

  console.log(`\n${'━'.repeat(50)}`);
  if (dryRun) {
    console.log('No files modified or created (dry run)\n');
  } else {
    console.log(`${filesModified} file(s) updated, ${filesCreated} file(s) created\n`);
  }
}
