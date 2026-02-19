#!/usr/bin/env bun
import { Command } from 'commander';
import { validate } from './validate.js';
import { diagram } from './diagram.js';
import { templateSync } from './template-sync.js';
import { loadConfig, resolveSpace } from './config.js';

const program = new Command();

program
  .name('ost-tools')
  .description('Opportunity Solution Tree validation and diagram generation tool')
  .version('0.1.0');

program
  .command('validate')
  .description('Validate OST nodes against JSON schema')
  .argument('<space-or-dir>', 'Space alias (e.g. "personal") or directory path')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .action((spaceOrDir, options) => validate(resolveSpace(spaceOrDir, loadConfig()), options));

program
  .command('diagram')
  .description('Generate mermaid diagram from OST nodes')
  .argument('<space-or-dir>', 'Space alias (e.g. "personal") or directory path')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .action((spaceOrDir, options) => diagram(resolveSpace(spaceOrDir, loadConfig()), options));

program
  .command('template-sync')
  .description('Sync OST template frontmatter with schema examples')
  .argument('<template-dir>', 'Directory containing OST template markdown files')
  .option('-s, --schema <path>', 'Path to JSON schema file', 'schema.json')
  .option('--dry-run', 'Preview changes without writing files')
  .action(templateSync);

program.parse();
