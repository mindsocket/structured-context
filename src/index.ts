#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import chokidar from 'chokidar';
import { Command } from 'commander';
import { diagram } from './commands/diagram';
import { dump } from './commands/dump';
import { listSchemas, showSchema } from './commands/schemas';
import { show } from './commands/show';
import { listSpaces } from './commands/spaces';
import { templateSync } from './commands/template-sync';
import { validate } from './commands/validate';
import {
  getConfigSourceFiles,
  loadConfig,
  resolveSchema,
  resolveSpacePath,
  resolveTemplateSettings,
  setConfigPath,
} from './config';
import { miroSync } from './miro/sync';
import { bundledSchemasDir } from './schema';

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
  .argument('<space-dir-or-file>', 'Space name, directory path, or space_on_a_page .md file')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .option('-w, --watch', 'Watch for changes and re-run validation')
  .action(async (spaceOrDir, options) => {
    const config = loadConfig();
    const space = config.spaces.find((s) => s.name === spaceOrDir);
    const spacePath = space?.path ?? resolveSpacePath(spaceOrDir, config);
    const schemaPath = resolveSchema(options.schema, config, space);
    const templateDir = space?.templateDir ?? config.templateDir;

    if (options.watch) {
      // Watch mode - set up watchers and re-run on changes
      const configFiles = Array.from(getConfigSourceFiles());
      const schemaDir = dirname(schemaPath);
      const schemaDirs = [bundledSchemasDir];
      if (schemaDir !== bundledSchemasDir) {
        schemaDirs.push(schemaDir);
      }

      console.log(`👀 Watching for changes...`);
      console.log(`   Config files: ${configFiles.join(', ')}`);
      console.log(`   Schema dirs: ${schemaDirs.join(', ')}`);
      console.log(`   Space:  ${spacePath}`);
      console.log(`   Press Ctrl+C to stop\n`);

      // Save cursor position after header (for clearing later)
      process.stdout.write('\x1b[s');

      let exitCode = 0;
      const innerValidate = async () => {
        try {
          exitCode = await validate(spacePath, { schema: schemaPath, templateDir });
        } catch (error) {
          console.error(`❌ Error during validation: ${error instanceof Error ? error.message : String(error)}`);
          exitCode = 1;
        }
      };
      await innerValidate();

      // Collect paths to watch (all config files, schema dirs, and space path)
      const watchPaths = [...configFiles, ...schemaDirs, spacePath];

      // Set up watcher
      const watcher = chokidar.watch(watchPaths, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      });

      const handleFileChange = async (filePath: string, action: string) => {
        // Restore cursor to header position and clear everything below
        process.stdout.write('\x1b[u\x1b[0J');
        console.log(`🔄 ${filePath} ${action}, re-validating...\n`);
        await innerValidate();
      };

      watcher.on('add', (path) => handleFileChange(path, 'added'));
      watcher.on('change', (path) => handleFileChange(path, 'changed'));
      watcher.on('unlink', (path) => handleFileChange(path, 'removed'));

      watcher.on('error', (error) => {
        console.error(`Watcher error: ${error}`);
      });

      // Keep process alive
      process.on('SIGINT', () => {
        console.log('\n\n👋 Stopping watch mode...');
        watcher.close();
        process.exit(exitCode);
      });
    } else {
      const exitCode = await validate(spacePath, { schema: schemaPath, templateDir });
      process.exit(exitCode);
    }
  });

program
  .command('diagram')
  .description('Generate mermaid diagram from space')
  .argument('<space-dir-or-file>', 'Space name, directory path, or space_on_a_page .md file')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .action((spaceOrDir, options) => {
    const config = loadConfig();
    const space = config.spaces.find((s) => s.name === spaceOrDir);
    diagram(space?.path ?? resolveSpacePath(spaceOrDir, config), {
      ...options,
      schema: resolveSchema(options.schema, config, space),
      templateDir: space?.templateDir ?? config.templateDir,
    });
  });

program
  .command('show')
  .description('Print space tree as an indented list')
  .argument('<space-dir-or-file>', 'Space name, directory path, or space_on_a_page .md file')
  .action((arg) => show(resolveSpacePath(arg, loadConfig())));

program
  .command('dump')
  .description('Dump parsed space nodes as JSON')
  .argument('<space-dir-or-file>', 'Space name, directory path, or space_on_a_page .md file')
  .action((arg) => dump(resolveSpacePath(arg, loadConfig())));

program
  .command('miro-sync')
  .description('Sync space to a Miro board')
  .argument('<space>', 'Space name (must have miroBoardId in config)')
  .option('--new-frame <title>', 'Create a new frame on the board and sync into it')
  .option('--dry-run', 'Show what would change without touching Miro')
  .option('-v, --verbose', 'Detailed output')
  .action(miroSync);

program
  .command('template-sync')
  .description('Sync template frontmatter with schema examples')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .option('--space <name>', 'Space name to use for template-dir and schema')
  .option('--create-missing', 'Create missing template files for schema types')
  .option('--dry-run', 'Preview changes without writing files')
  .action((options) => {
    const config = loadConfig();
    const space = options.space ? config.spaces.find((s) => s.name === options.space) : undefined;
    if (options.space && !space) {
      console.error(`Error: Unknown space "${options.space}"`);
      process.exit(1);
    }
    const { templateDir, templatePrefix } = resolveTemplateSettings(config, space);
    templateSync(templateDir, {
      ...options,
      schema: resolveSchema(options.schema, config, space),
      templatePrefix,
      fieldMap: space?.fieldMap,
    });
  });

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
  .action(() => {
    const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf-8');
    process.stdout.write(readme);
  });

program.parse();
