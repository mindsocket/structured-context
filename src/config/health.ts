import { existsSync } from 'node:fs';
import { LOCAL_CONFIG_FILE } from '../constants';
import { SctxError, type SctxErrorCode } from '../errors';
import { type Config, getConfigSourceFiles, loadConfig, type ResolvedConfigPath, resolveConfigPath } from '.';

export type ConfigProblem = {
  code: SctxErrorCode;
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix: string;
  space?: string;
};

export type ConfigHealth = {
  config: ResolvedConfigPath & { exists: boolean };
  configFiles: string[];
  spaces: { name: string; path: string; schema?: string }[];
  problems: ConfigProblem[];
};

const FIXES: Partial<Record<SctxErrorCode, string>> = {
  E_CONFIG_NOT_FOUND: `Create a config with \`sctx spaces add <name> <path> --schema <schema> --config <folder>/${LOCAL_CONFIG_FILE}\`, or use the setup-space skill.`,
  E_CONFIG_INVALID: 'Fix the JSON in the config file named in the message; `sctx docs config` describes the shape.',
  E_INCLUDE_NOT_FOUND: 'Correct or remove the missing path in `includeSpacesFrom`.',
  E_NO_SPACES: 'Add a space with `sctx spaces add`.',
  E_SPACE_PATH_MISSING: 'The folder or file was moved or deleted. Correct `path` in the config, or remove the space.',
  E_SCHEMA_MISSING: 'Set `schema` on the space or at the top level of the config file.',
  E_SCHEMA_NOT_FOUND: 'Check the schema name or path. `sctx schemas list` shows the bundled schemas.',
  E_SCHEMA_INVALID:
    'The schema could not be loaded. The message says what to fix; `sctx docs schema` describes the format.',
};

export function fixFor(code: SctxErrorCode): string {
  return FIXES[code] ?? '';
}

function problem(
  code: SctxErrorCode,
  severity: ConfigProblem['severity'],
  message: string,
  space?: string,
): ConfigProblem {
  return { code, severity, message, fix: fixFor(code), ...(space ? { space } : {}) };
}

/**
 * Find and load the config for the working directory, reporting failures as problems with stable
 * codes instead of throwing. It reports on the config only: what a space's `path` means belongs to
 * the plugin that reads it, and a schema is checked when it is loaded.
 */
export function inspectConfig(options: { startDir?: string } = {}): { health: ConfigHealth; config?: Config } {
  const resolved = resolveConfigPath(options.startDir);
  const exists = existsSync(resolved.path);
  const health: ConfigHealth = { config: { ...resolved, exists }, configFiles: [], spaces: [], problems: [] };

  if (!exists) {
    const detail =
      resolved.source === 'none'
        ? `No ${LOCAL_CONFIG_FILE} found from the working directory upward, and no global config at ${resolved.path}`
        : `Config file not found: ${resolved.path}`;
    health.problems.push(problem('E_CONFIG_NOT_FOUND', resolved.source === 'none' ? 'info' : 'error', detail));
    return { health };
  }

  let config: Config;
  try {
    config = loadConfig({ startDir: options.startDir });
  } catch (err) {
    const code = err instanceof SctxError ? err.code : 'E_CONFIG_INVALID';
    health.problems.push(problem(code, 'error', (err as Error).message));
    return { health };
  }
  health.configFiles = [...getConfigSourceFiles()];
  health.spaces = config.spaces.map((s) => ({ name: s.name, path: s.path, schema: s.schema ?? config.schema }));
  return { health, config };
}

/** True when the config problems stop validation from running. */
export function hasBlockingProblem(health: ConfigHealth): boolean {
  return health.problems.some((p) => p.severity === 'error');
}
