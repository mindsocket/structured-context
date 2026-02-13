#!/usr/bin/env bun
import { Command } from 'commander';
import { validate } from './validate.js';
import { diagram } from './diagram.js';

const program = new Command();

program
  .name('ost-tools')
  .description('Opportunity Solution Tree validation and diagram generation tool')
  .version('0.1.0');

program
  .command('validate')
  .description('Validate OST nodes against JSON schema')
  .argument('<directory>', 'Directory containing OST node markdown files')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .action(validate);

program
  .command('diagram')
  .description('Generate mermaid diagram from OST nodes')
  .argument('<directory>', 'Directory containing OST node markdown files')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('-s, --schema <path>', 'Path to JSON schema file')
  .action(diagram);

program.parse();
