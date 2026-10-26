import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import JSON5 from 'json5';
import { globalConfigPath, resolveConfigPath, resolveSchemaPath } from './config';
import { LOCAL_CONFIG_FILE } from './constants';
import { SctxError } from './errors';

export type AddSpaceOptions = {
  name: string;
  /** Path to the space, relative to the working directory or absolute. Must exist. */
  path: string;
  schema?: string;
  /** Write to the global config file. */
  global?: boolean;
  /** Write to this config file (created if missing), bypassing discovery. For library callers that know the target. */
  configFile?: string;
  /** Where discovery starts when no explicit target is given. Defaults to the working directory. */
  startDir?: string;
};

export type AddSpaceResult = {
  configPath: string;
  created: boolean;
  space: { name: string; path: string; schema?: string };
};

/**
 * Decide which file to write. A config named explicitly (`--config`, `$SCTX_CONFIG`) or found by walking up
 * from the working directory is used as is. If discovery would land on the global file or on nothing, the
 * caller must say where to write, so a vault's space never ends up in the global file by accident.
 */
export function chooseWriteTarget(options: { global?: boolean; configFile?: string; startDir?: string }): string {
  if (options.configFile) return options.configFile;
  const resolved = resolveConfigPath(options.startDir);
  if (options.global) {
    if (resolved.source === 'override' || resolved.source === 'env') {
      throw new SctxError('E_TARGET_REQUIRED', '--global cannot be combined with --config or $SCTX_CONFIG');
    }
    return globalConfigPath();
  }
  if (resolved.source === 'override' || resolved.source === 'env' || resolved.source === 'local') {
    return resolved.path;
  }
  const found = resolved.source === 'global' ? `only the global config (${resolved.path}) exists` : 'no config exists';
  throw new SctxError(
    'E_TARGET_REQUIRED',
    `No ${LOCAL_CONFIG_FILE} found from ${resolve(options.startDir ?? process.cwd())} upward; ${found}. ` +
      `Say where to write: --config <folder>/${LOCAL_CONFIG_FILE} (the usual choice: the folder that holds your notes), or --global.`,
  );
}

function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** The path as written in the config: relative to the config's folder when inside it, else absolute. */
function storedPath(configFile: string, absolutePath: string): string {
  // Compare real paths so a symlinked folder (such as macOS's /var -> /private/var) does not look like it escapes
  const rel = relative(realOrSelf(dirname(resolve(configFile))), realOrSelf(absolutePath));
  if (rel === '') return '.';
  return rel.startsWith('..') || isAbsolute(rel) ? absolutePath : rel;
}

/** Add a space to the chosen config file, creating the file when it does not exist. */
export function addSpace(options: AddSpaceOptions): AddSpaceResult {
  if (!/^[a-z0-9_-]+$/.test(options.name)) {
    throw new SctxError(
      'E_CONFIG_INVALID',
      `Space name "${options.name}" must use lowercase letters, digits, "-" and "_"`,
    );
  }
  const target = resolve(chooseWriteTarget(options));
  const spacePath = resolve(options.startDir ?? process.cwd(), options.path);
  if (!existsSync(spacePath)) {
    throw new SctxError('E_SPACE_PATH_MISSING', `Space path does not exist: ${spacePath}`);
  }

  const created = !existsSync(target);
  let config: { spaces?: Array<Record<string, unknown>>; schema?: string; [key: string]: unknown } = { spaces: [] };
  if (!created) {
    const raw = readFileSync(target, 'utf-8');
    try {
      config = JSON.parse(raw);
    } catch {
      try {
        JSON5.parse(raw);
      } catch (err) {
        throw new SctxError('E_CONFIG_INVALID', `Invalid config in ${target}: ${(err as Error).message}`);
      }
      throw new SctxError(
        'E_CONFIG_NEEDS_MANUAL_EDIT',
        `${target} uses JSON5 features (comments or trailing commas) that rewriting would remove. ` +
          `Add this entry to "spaces" by hand: ${JSON.stringify({ name: options.name, path: storedPath(target, spacePath), ...(options.schema ? { schema: options.schema } : {}) })}`,
      );
    }
  }
  if (!config.schema && !options.schema) {
    throw new SctxError(
      'E_SCHEMA_MISSING',
      'Give --schema <name or path>: neither the space nor the config file names a schema',
    );
  }
  if (options.schema && !/^https?:\/\//i.test(options.schema)) {
    const schemaPath = resolveSchemaPath(options.schema, dirname(target));
    if (!existsSync(schemaPath) && !options.schema.includes('/')) {
      throw new SctxError(
        'E_SCHEMA_NOT_FOUND',
        `Schema not found: ${options.schema}. \`sctx schemas list\` shows the bundled schemas.`,
      );
    }
  }
  config.spaces = config.spaces ?? [];
  if (config.spaces.some((s) => s.name === options.name)) {
    throw new SctxError('E_SPACE_EXISTS', `${target} already defines a space named "${options.name}"`);
  }
  const space = {
    name: options.name,
    path: storedPath(target, spacePath),
    ...(options.schema ? { schema: options.schema } : {}),
  };
  config.spaces.push(space);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath: target, created, space };
}
