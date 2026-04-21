import { loadConfig } from '../config';
import type { FileValidationResult } from '../types';
import { validateFile } from '../validate';

export { validateFile } from '../validate';

/**
 * CLI command: validate a file and print results to stdout.
 * Loads config automatically from the environment, outputs human-readable or JSON,
 * and returns an exit code (0 = valid, 1 = errors found).
 */
export async function validateFileCommand(filePath: string, options: { json?: boolean } = {}): Promise<number> {
  const config = loadConfig();
  const result = await validateFile(filePath, config);

  if (!result.inSpace) {
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    return 0;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanReadable(result);
  }

  return result.errorCount > 0 ? 1 : 0;
}

function printHumanReadable(result: FileValidationResult): void {
  const reset = '\x1b[0m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';

  if (result.errorCount === 0 && result.warningCount === 0) {
    console.log(`${green}✓${reset} ${result.label} (space: ${result.space})`);
    return;
  }

  if (result.errorCount > 0) {
    console.log(`\n${red}✗${reset} ${result.label} (space: ${result.space}) — ${result.errorCount} error(s)\n`);
    for (const { kind, message } of Object.values(result.errors)) {
      console.log(`  [${kind}] ${message}`);
    }
  } else {
    console.log(`\n${green}✓${reset} ${result.label} (space: ${result.space})`);
  }

  if (result.warningCount > 0) {
    console.log(`\n  ${yellow}${result.warningCount} warning(s):${reset}`);
    for (const { kind, message } of Object.values(result.warnings)) {
      console.log(`  ${yellow}[${kind}]${reset} ${message}`);
    }
  }

  console.log('');
}
