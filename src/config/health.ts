import { existsSync, readFileSync } from 'node:fs';
import JSON5 from 'json5';
import { LOCAL_CONFIG_FILE } from '../constants';
import { SctxError, type SctxErrorCode } from '../errors';
import { getConfigSourceFiles, loadConfig, type ResolvedConfigPath, resolveConfigPath, resolveSchema } from '.';

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
 * Check that the config for the working directory can be found and loaded, and that each space's
 * path and schema exist. Never throws: every failure becomes a problem with a stable code.
 */
export function checkConfig(options: { startDir?: string } = {}): ConfigHealth {
  const resolved = resolveConfigPath(options.startDir);
  const exists = existsSync(resolved.path);
  const health: ConfigHealth = { config: { ...resolved, exists }, configFiles: [], spaces: [], problems: [] };

  if (!exists) {
    const detail =
      resolved.source === 'none'
        ? `No ${LOCAL_CONFIG_FILE} found from the working directory upward, and no global config at ${resolved.path}`
        : `Config file not found: ${resolved.path}`;
    health.problems.push(problem('E_CONFIG_NOT_FOUND', resolved.source === 'none' ? 'info' : 'error', detail));
    return health;
  }

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig({ startDir: options.startDir });
  } catch (err) {
    const code = err instanceof SctxError ? err.code : 'E_CONFIG_INVALID';
    health.problems.push(problem(code, 'error', (err as Error).message));
    return health;
  }
  health.configFiles = [...getConfigSourceFiles()];
  health.spaces = config.spaces.map((s) => ({ name: s.name, path: s.path, schema: s.schema ?? config.schema }));

  if (config.spaces.length === 0) {
    health.problems.push(problem('E_NO_SPACES', 'warning', `Config ${resolved.path} defines no spaces`));
  }

  for (const space of config.spaces) {
    if (!existsSync(space.path)) {
      health.problems.push(
        problem(
          'E_SPACE_PATH_MISSING',
          'error',
          `Space "${space.name}" path does not exist: ${space.path}`,
          space.name,
        ),
      );
    }
    const schemaRef = space.schema ?? config.schema;
    if (!schemaRef) {
      health.problems.push(problem('E_SCHEMA_MISSING', 'error', `Space "${space.name}" has no schema`, space.name));
      continue;
    }
    let schemaPath: string;
    try {
      schemaPath = resolveSchema(config, space);
    } catch (err) {
      health.problems.push(problem('E_SCHEMA_NOT_FOUND', 'error', (err as Error).message, space.name));
      continue;
    }
    if (/^https?:\/\//i.test(schemaPath)) continue;
    if (!existsSync(schemaPath)) {
      health.problems.push(
        problem('E_SCHEMA_NOT_FOUND', 'error', `Space "${space.name}" schema not found: ${schemaPath}`, space.name),
      );
      continue;
    }
    try {
      JSON5.parse(readFileSync(schemaPath, 'utf-8'));
    } catch (err) {
      health.problems.push(
        problem(
          'E_SCHEMA_INVALID',
          'error',
          `Space "${space.name}" schema ${schemaPath} is not valid: ${(err as Error).message}`,
          space.name,
        ),
      );
    }
  }
  return health;
}

/** True when the health check found something that stops validation from running. */
export function hasBlockingProblem(health: ConfigHealth): boolean {
  return health.problems.some((p) => p.severity === 'error');
}
