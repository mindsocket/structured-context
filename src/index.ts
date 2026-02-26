#!/usr/bin/env bun
import { Command } from 'commander';
import { validate } from './validate.js';
import { diagram } from './diagram.js';
import { show } from './show.js';
import { dump } from './dump.js';
import { templateSync } from './template-sync.js';
import { miroSync } from './miro/sync.js';
import { loadConfig, resolveSchema, resolveSpacePath, resolveTemplateDir } from './config.js';

const program = new Command();

program
  .name('ost-tools')
  .description('Opportunity Solution Tree validation and diagram generation tool')
  .version('0.1.0');

program
  .command('validate')
  .description('Validate OST nodes against JSON schema')
  .argument('<space-dir-or-file>', 'Space alias, directory path, or OST-on-a-page .md file')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .action((spaceOrDir, options) => {
    const config = loadConfig();
    validate(resolveSpacePath(spaceOrDir, config), { ...options, schema: resolveSchema(options.schema, config) });
  });

program
  .command('diagram')
  .description('Generate mermaid diagram from OST nodes')
  .argument('<space-dir-or-file>', 'Space alias, directory path, or OST-on-a-page .md file')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .action((spaceOrDir, options) => {
    const config = loadConfig();
    diagram(resolveSpacePath(spaceOrDir, config), { ...options, schema: resolveSchema(options.schema, config) });
  });

program
  .command('show')
  .description('Print OST tree as an indented list')
  .argument('<space-dir-or-file>', 'Space alias, directory path, or OST-on-a-page .md file')
  .action((arg) => show(resolveSpacePath(arg, loadConfig())));

program
  .command('dump')
  .description('Dump parsed OST nodes as JSON')
  .argument('<space-dir-or-file>', 'Space alias, directory path, or OST-on-a-page .md file')
  .action((arg) => dump(resolveSpacePath(arg, loadConfig())));

program
  .command('miro-sync')
  .description('Sync OST tree to a Miro board')
  .argument('<space>', 'Space alias (must have miroBoardId in config)')
  .option('--new-frame <title>', 'Create a new frame on the board and sync into it')
  .option('--dry-run', 'Show what would change without touching Miro')
  .option('-v, --verbose', 'Detailed output')
  .action(miroSync);

program
  .command('template-sync')
  .description('Sync OST template frontmatter with schema examples')
  .argument('[template-dir]', 'Directory containing OST template markdown files')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .option('--dry-run', 'Preview changes without writing files')
  .action((templateDir, options) => {
    const config = loadConfig();
    templateSync(resolveTemplateDir(templateDir, config), { ...options, schema: resolveSchema(options.schema, config) });
  });

program.parse();
