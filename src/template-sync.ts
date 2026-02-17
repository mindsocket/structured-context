import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import matter from 'gray-matter';
import yaml from 'js-yaml';

interface TypeVariant {
  required: string[];
  optional: string[];
  properties: Record<string, any>;
  example: Record<string, any>;
}

function resolveRef(propDef: any, schema: any): any {
  if (propDef?.$ref) {
    const path = (propDef.$ref as string).replace(/^#\//, '').split('/');
    return path.reduce((obj: any, key: string) => obj[key], schema);
  }
  return propDef;
}

function enumPlaceholder(def: any): string {
  return def.enum.join('|');
}

function withEnumPlaceholders(
  example: Record<string, any>,
  properties: Record<string, any>,
  schema: any
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(example).map(([key, value]) => {
      const def = resolveRef(properties[key], schema);
      return def?.enum ? [key, enumPlaceholder(def)] : [key, value];
    })
  );
}

function commentedHint(fieldName: string, propDef: any, schema: any): string {
  const def = resolveRef(propDef, schema);
  let value: string;
  if (def?.enum) {
    value = enumPlaceholder(def);
  } else if (def?.type === 'integer') {
    value = String(Math.ceil(((def.minimum ?? 1) + (def.maximum ?? 5)) / 2));
  } else if (def?.type === 'array') {
    value = '[]';
  } else {
    value = '""';
  }
  return `# ${fieldName}: ${value}`;
}

function getTypeVariants(schema: any): Map<string, TypeVariant> {
  const map = new Map<string, TypeVariant>();
  for (const variant of schema.oneOf) {
    const typeName = variant.properties?.type?.const as string;
    if (!typeName || typeName === 'dashboard') continue;
    if (!variant.examples?.[0]) continue;

    const required = (variant.required as string[]).filter((k: string) => k !== 'type');
    const properties = Object.fromEntries(
      Object.entries(variant.properties as Record<string, any>).filter(([k]) => k !== 'type')
    );
    const optional = Object.keys(properties).filter(k => !required.includes(k));
    const example = variant.examples[0] as Record<string, any>;

    map.set(typeName, { required, optional, properties, example });
  }
  return map;
}

export async function templateSync(
  templateDir: string,
  options: { schema: string; dryRun?: boolean }
) {
  const schema = JSON.parse(readFileSync(options.schema, 'utf-8'));
  const typeVariants = getTypeVariants(schema);

  const files = await glob('OST - *.md', { cwd: templateDir, absolute: true });
  if (files.length === 0) {
    console.log(`No OST template files found in ${templateDir}`);
    return;
  }

  const dryRun = options.dryRun ?? false;
  let filesModified = 0;

  console.log(`\n🔄 OST Template Sync`);
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

    const { example, optional, properties } = variant;
    const exampleKeys = new Set(Object.keys(example));

    const exampleWithPlaceholders = withEnumPlaceholders(example, properties, schema);
    const frontmatterYaml = (yaml.dump(exampleWithPlaceholders, { lineWidth: -1 }) as string).trim();
    const hints = optional
      .filter(field => !exampleKeys.has(field))
      .map(field => commentedHint(field, properties[field], schema));

    const newFrontmatter = hints.length > 0
      ? `${frontmatterYaml}\n${hints.join('\n')}`
      : frontmatterYaml;

    const newContent = `---\n${newFrontmatter}\n---${body}`;

    if (newContent === content) {
      console.log(`✓  ${filename}`);
    } else {
      console.log(`📝 ${filename}: updated`);
      if (!dryRun) {
        writeFileSync(file, newContent);
        filesModified++;
      }
    }
  }

  console.log('\n' + '━'.repeat(50));
  if (dryRun) {
    console.log('No files modified (dry run)\n');
  } else {
    console.log(`${filesModified} file(s) updated\n`);
  }
}
