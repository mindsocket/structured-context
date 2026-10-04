import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { discoverPlugins, type LoadedPlugin, loadPlugins } from '../plugins/loader';
import { isRenderMultiFileOutput } from '../plugins/util';
import { buildFormatRegistry } from '../render/registry';
import { executeRender } from '../render/render';
import type { SpaceContext } from '../types';

export async function render(
  context: SpaceContext,
  format: string,
  options: {
    filter?: string;
    hierarchy?: string;
    output?: string;
    out?: string;
    force?: boolean;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const result = await executeRender(format, context, {
    filter: options.filter,
    hierarchy: options.hierarchy,
    data: options.data,
  });

  const targetPath = options.out ?? options.output;
  const force = Boolean(options.force);

  if (typeof result === 'string') {
    if (targetPath) {
      const resolved = resolve(targetPath);
      if (existsSync(resolved)) {
        if (statSync(resolved).isDirectory()) {
          throw new Error(`Output path "${targetPath}" is a directory. Please specify a file path.`);
        }
        if (!force) {
          throw new Error(`File "${targetPath}" already exists. Use --force to overwrite.`);
        }
      }
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, result, 'utf8');
      console.error(`Written to ${targetPath}`);
    } else {
      process.stdout.write(result);
      if (!result.endsWith('\n')) process.stdout.write('\n');
    }
    return;
  }

  if (isRenderMultiFileOutput(result)) {
    if (targetPath) {
      const targetDir = resolve(targetPath);
      const conflicts: string[] = [];

      for (const file of result.files) {
        const fullPath = join(targetDir, file.path);
        if (existsSync(fullPath)) {
          conflicts.push(file.path);
        }
      }

      if (conflicts.length > 0 && !force) {
        const preview = conflicts
          .slice(0, 5)
          .map((f) => `  ${f}`)
          .join('\n');
        const extra = conflicts.length > 5 ? `\n  ... and ${conflicts.length - 5} more` : '';
        throw new Error(
          `Refusing to overwrite ${conflicts.length} existing file(s) in "${targetPath}" without --force:\n${preview}${extra}`,
        );
      }

      for (const file of result.files) {
        const fullPath = join(targetDir, file.path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, file.content, 'utf8');
      }
      console.error(`Written ${result.files.length} file(s) to ${targetPath}`);
    } else {
      console.log(`Rendered ${result.files.length} file(s):`);
      for (const file of result.files) {
        const bytes = Buffer.byteLength(file.content, 'utf8');
        console.log(`  ${file.path} (${bytes} bytes)`);
      }
      console.log('\nSpecify --out <dir> to write files to disk.');
    }
  }
}

export async function renderList(context?: SpaceContext): Promise<void> {
  let loaded: LoadedPlugin[];
  if (context) {
    const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
    loaded = await loadPlugins(pluginMap, context.configDir);
  } else {
    const discovered = await discoverPlugins();
    loaded = discovered.map((plugin) => ({ plugin, pluginConfig: {} }));
  }

  const registry = buildFormatRegistry(loaded);

  if (registry.length === 0) {
    console.log('No render formats available.');
    return;
  }

  for (const entry of registry) {
    console.log(`  ${entry.qualifiedName.padEnd(24)} ${entry.format.description}`);
  }
}
