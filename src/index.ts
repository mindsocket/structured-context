#!/usr/bin/env bun
import { createRequire } from 'node:module';
import { format } from 'node:util';
import { Command } from 'commander';
import { diagram } from './commands/diagram';
import { docs } from './commands/docs';
import { dump } from './commands/dump';
import { miroSyncCommand } from './commands/miro-sync';
import { listPlugins } from './commands/plugins';
import { render, renderList } from './commands/render';
import { listSchemas, showSchema } from './commands/schemas';
import { show } from './commands/show';
import { listSpaces } from './commands/spaces';
import { templateSync } from './commands/template-sync';
import { validate, watchValidate } from './commands/validate';
import { validateFileCommand } from './commands/validate-file';
import { loadConfig, setConfigPath } from './config';
import { CLI_NAME } from './constants';
import { createSpaceContext, SpaceNotFoundError } from './space-context';
import type { SpaceContext } from './types';

// Once node:process is loaded (vfile, via unified, loads it), Bun's console.log drops piped output
// past 64KB when the reader is slow. process.stdout.write delivers all of it before exit.
console.log = (...args: unknown[]) => {
  process.stdout.write(`${format(...args)}\n`);
};

export function buildSpaceContext(spaceName: string): SpaceContext {
  try {
    return createSpaceContext(spaceName, loadConfig());
  } catch (err) {
    if (err instanceof SpaceNotFoundError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const program = new Command();

program
  .name(CLI_NAME)
  .description('Structured context validation and diagram generation tool')
  .version(packageJson.version)
  .option('--config <path>', 'Path to config file (overrides default config.json locations)');

program.hook('preAction', () => {
  setConfigPath(program.opts().config);
});

program
  .command('validate-file')
  .description('Validate a single file within its space')
  .argument('<path>', 'Path to the file to validate')
  .option('--json', 'Output results as JSON (machine-readable, for hooks)')
  .action(async (filePath, options) => {
    process.exitCode = await validateFileCommand(filePath, { json: options.json });
  });

program
  .command('validate')
  .description('Validate space against JSON schema')
  .argument('<space-name>', 'Space name')
  .option('-w, --watch', 'Watch for changes and re-run validation')
  .option('--json', 'Output results as JSON')
  .action(async (spaceName, options) => {
    const context = buildSpaceContext(spaceName);
    if (options.watch) {
      await watchValidate(context);
    } else {
      // exitCode rather than process.exit(): exiting straight away can cut off large piped output
      process.exitCode = await validate(context, { json: options.json });
    }
  });

program
  .command('diagram')
  .description('Generate mermaid diagram from space')
  .argument('<space-name>', 'Space name')
  .option('--filter <filter>', 'Filter view name (from config) or inline filter expression')
  .option('--hierarchy <name>', 'Hierarchy to render (default: the main hierarchy)')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .action(async (spaceName, options) => diagram(buildSpaceContext(spaceName), options));

program
  .command('show')
  .description('Print space graph as a bullet list')
  .argument('<space-name>', 'Space name')
  .option('--filter <filter>', 'Filter view name (from config) or inline filter expression')
  .option('--hierarchy <name>', 'Hierarchy to render (default: the main hierarchy)')
  .action(async (spaceName, options) => show(buildSpaceContext(spaceName), options));

program
  .command('dump')
  .description('Dump parsed space nodes as JSON')
  .argument('<space-name>', 'Space name')
  .option('--filter <filter>', 'Filter view name (from config) or inline filter expression')
  .option('--hierarchy <name>', 'Hierarchy used to evaluate --filter (default: the main hierarchy)')
  .action(async (spaceName, options) => dump(buildSpaceContext(spaceName), options));

program
  .command('miro-sync')
  .description('Sync space to a Miro board')
  .argument('<space-name>', 'Space name (must have miroBoardId in config)')
  .option('--new-frame <title>', 'Create a new frame on the board and sync into it')
  .option('--dry-run', 'Show what would change without touching Miro')
  .option('-v, --verbose', 'Detailed output')
  .action(async (spaceName, options) => miroSyncCommand(buildSpaceContext(spaceName), options));

program
  .command('template-sync')
  .description('Sync schema examples to templates')
  .argument('<space-name>', 'Space name')
  .option('--create-missing', 'Create missing template files for schema types')
  .option('--dry-run', 'Preview changes without writing files')
  .action(async (spaceName, options) => {
    const context = buildSpaceContext(spaceName);
    await templateSync(context, options);
  });

program
  .command('plugins')
  .description('List available plugins')
  .action(async () => listPlugins());

const spacesCmd = new Command('spaces').description('List configured spaces');
spacesCmd
  .command('list', { isDefault: true })
  .description('List all configured spaces and their paths')
  .option('--json', 'Output as JSON: config files, and each space with its path and schema')
  .action((options) => listSpaces(options));
program.addCommand(spacesCmd);

const schemasCmd = new Command('schemas').alias('schema').description('List and inspect schemas');
schemasCmd
  .command('list', { isDefault: true })
  .description('List available schemas')
  .action(async () => await listSchemas());
schemasCmd
  .command('show')
  .description('Show schema structure (or raw JSON with --raw, or Mermaid ERD with --mermaid-erd)')
  .argument('[file]', 'Schema filename or path (omit to use --space)')
  .option('--space <name>', 'Resolve schema from space config')
  .option('--raw', 'Output raw JSON file content')
  .option('--mermaid-erd', 'Output Mermaid Entity Relationship Diagram')
  .action(
    async (file, options) =>
      await showSchema(file, {
        space: options.space,
        raw: options.raw ?? false,
        mermaidErd: options.mermaidErd ?? false,
      }),
  );
program.addCommand(schemasCmd);

program
  .command('docs [topic]')
  .description('Show documentation (no arg: README; topics: concepts, config, schema, rules)')
  .action((topic?: string) => docs(topic));

const renderCmd = new Command('render').description('Render a space in a given format');
renderCmd
  .command('list', { isDefault: false })
  .description('List available render formats')
  .argument('[space-name]', 'Space name (optional, to show space-specific formats)')
  .action(async (spaceName?: string) => {
    const context = spaceName ? buildSpaceContext(spaceName) : undefined;
    await renderList(context);
  });
function parseDataOptions(val: string, prev: Record<string, string> = {}): Record<string, string> {
  const eqIdx = val.indexOf('=');
  if (eqIdx >= 0) {
    prev[val.slice(0, eqIdx).trim()] = val.slice(eqIdx + 1).trim();
  } else {
    prev[val.trim()] = 'true';
  }
  return prev;
}

renderCmd
  .argument('<space-name>', 'Space name')
  .argument('<format>', 'Render format (e.g. markdown.bullets, markdown.directory)')
  .option('--filter <filter>', 'Filter view name (from config) or inline filter expression')
  .option('--hierarchy <name>', 'Hierarchy to render (default: the main hierarchy)')
  .option('-o, --output <path>', 'Output file or directory path (default: stdout)')
  .option('--out <path>', 'Output directory or file path')
  .option('-f, --force', 'Overwrite existing files when writing to disk')
  .option('-d, --data <key=value...>', 'Format-specific key=value options', parseDataOptions)
  .action(async (spaceName: string, format: string, options) => {
    await render(buildSpaceContext(spaceName), format, options);
  });
program.addCommand(renderCmd);

program.parse();
