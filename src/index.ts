#!/usr/bin/env bun
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { diagram } from './commands/diagram';
import { dump } from './commands/dump';
import { listPlugins } from './commands/plugins';
import { readme } from './commands/readme';
import { render, renderList } from './commands/render';
import { listSchemas, showSchema } from './commands/schemas';
import { show } from './commands/show';
import { listSpaces } from './commands/spaces';
import { templateSync } from './commands/template-sync';
import { validate, watchValidate } from './commands/validate';
import { getSpaceConfigDir, loadConfig, resolveSchema, setConfigPath } from './config';
import { miroSync } from './integrations/miro/sync';
import { loadSchema } from './schema/schema';
import type { SpaceContext } from './types';

export function buildSpaceContext(spaceName: string): SpaceContext {
  const config = loadConfig();
  const space = config.spaces.find((s) => s.name === spaceName);
  if (!space) {
    console.error(`Error: Unknown space "${spaceName}"`);
    process.exit(1);
  }
  const resolvedSchemaPath = resolveSchema(config, space);
  const { schema, schemaRefRegistry, schemaValidator } = loadSchema(resolvedSchemaPath);
  const configDir = getSpaceConfigDir(space.name);
  return {
    space,
    config,
    resolvedSchemaPath,
    schema,
    schemaRefRegistry,
    schemaValidator,
    configDir,
  };
}

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const program = new Command();

program
  .name('ost-tools')
  .description('Opportunity Solution Tree validation and diagram generation tool')
  .version(packageJson.version)
  .option('--config <path>', 'Path to config file (overrides default config.json locations)');

program.hook('preAction', () => {
  setConfigPath(program.opts().config);
});

program
  .command('validate')
  .description('Validate space against JSON schema')
  .argument('<space-name>', 'Space name')
  .option('-w, --watch', 'Watch for changes and re-run validation')
  .action(async (spaceName, options) => {
    const context = buildSpaceContext(spaceName);
    if (options.watch) {
      await watchValidate(context);
    } else {
      const exitCode = await validate(context);
      process.exit(exitCode);
    }
  });

program
  .command('diagram')
  .description('Generate mermaid diagram from space')
  .argument('<space-name>', 'Space name')
  .option('--filter <filter>', 'Filter view name (from config) or inline filter expression')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .action((spaceName, options) => diagram(buildSpaceContext(spaceName), options));

program
  .command('show')
  .description('Print space graph as a bullet list')
  .argument('<space-name>', 'Space name')
  .option('--filter <filter>', 'Filter view name (from config) or inline filter expression')
  .action((spaceName, options) => show(buildSpaceContext(spaceName), options));

program
  .command('dump')
  .description('Dump parsed space nodes as JSON')
  .argument('<space-name>', 'Space name')
  .action((spaceName) => dump(buildSpaceContext(spaceName)));

program
  .command('miro-sync')
  .description('Sync space to a Miro board')
  .argument('<space-name>', 'Space name (must have miroBoardId in config)')
  .option('--new-frame <title>', 'Create a new frame on the board and sync into it')
  .option('--dry-run', 'Show what would change without touching Miro')
  .option('-v, --verbose', 'Detailed output')
  .action((spaceName, options) => miroSync(buildSpaceContext(spaceName), options));

program
  .command('template-sync')
  .description('Sync schema examples to templates')
  .argument('<space-name>', 'Space name')
  .option('--create-missing', 'Create missing template files for schema types')
  .option('--dry-run', 'Preview changes without writing files')
  .action((spaceName, options) => {
    const context = buildSpaceContext(spaceName);
    templateSync(context, options);
  });

program
  .command('plugins')
  .description('List available plugins')
  .action(async () => listPlugins());

const spacesCmd = new Command('spaces').description('List configured spaces');
spacesCmd
  .command('list', { isDefault: true })
  .description('List all configured spaces and their paths')
  .action(listSpaces);
program.addCommand(spacesCmd);

const schemasCmd = new Command('schemas').alias('schema').description('List and inspect schemas');
schemasCmd
  .command('list', { isDefault: true })
  .description('List available schemas')
  .action(() => listSchemas());
schemasCmd
  .command('show')
  .description('Show schema structure (or raw JSON with --raw, or Mermaid ERD with --mermaid-erd)')
  .argument('[file]', 'Schema filename or path (omit to use --space)')
  .option('--space <name>', 'Resolve schema from space config')
  .option('--raw', 'Output raw JSON file content')
  .option('--mermaid-erd', 'Output Mermaid Entity Relationship Diagram')
  .action((file, options) =>
    showSchema(file, {
      space: options.space,
      raw: options.raw ?? false,
      mermaidErd: options.mermaidErd ?? false,
    }),
  );
program.addCommand(schemasCmd);

program
  .command('readme')
  .description('Show full README documentation')
  .action(() => readme());

const renderCmd = new Command('render').description('Render a space in a given format');
renderCmd
  .command('list', { isDefault: false })
  .description('List available render formats')
  .argument('[space-name]', 'Space name (optional, to show space-specific formats)')
  .action(async (spaceName?: string) => {
    const context = spaceName ? buildSpaceContext(spaceName) : undefined;
    await renderList(context);
  });
renderCmd
  .argument('<space-name>', 'Space name')
  .argument('<format>', 'Render format (e.g. markdown.bullets)')
  .option('--filter <filter>', 'Filter view name (from config) or inline filter expression')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .action(async (spaceName: string, format: string, options) => {
    await render(buildSpaceContext(spaceName), format, options);
  });
program.addCommand(renderCmd);

program.parse();
