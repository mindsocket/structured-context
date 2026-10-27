import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { LOCAL_CONFIG_FILE } from '../constants';
import { SctxError } from '../errors';
import { globalConfigPath, resolveConfigPath, resolveSchemaPath, type SpaceConfig } from '.';

type AddSpaceOptions = Pick<SpaceConfig, 'name' | 'path' | 'schema'> & {
  /** Write to the global config file. */
  global?: boolean;
  /** Write to this config file (created if missing) instead of the discovered one. */
  configFile?: string;
  /** Where discovery starts when no explicit target is given. Defaults to the working directory. */
  startDir?: string;
};

type AddSpaceResult = {
  configPath: string;
  created: boolean;
  space: Pick<SpaceConfig, 'name' | 'path' | 'schema'>;
};

/**
 * Decide which file to write. A config named explicitly or found by walking up from the working directory
 * is used as is. If discovery would land on the global file or on nothing, the caller must say where to
 * write, so a vault's space never ends up in the global file by accident.
 */
export function resolveWriteTarget(options: { global?: boolean; configFile?: string; startDir?: string }): string {
  if (options.configFile) return options.configFile;
  const resolved = resolveConfigPath(options.startDir);
  if (options.global) {
    if (resolved.source === 'override' || resolved.source === 'env') {
      throw new SctxError('E_TARGET_REQUIRED', 'The global config cannot be combined with an explicitly named config');
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
      `Specify the config file location or global option.`,
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
  const target = resolve(resolveWriteTarget(options));
  const spacePath = resolve(options.startDir ?? process.cwd(), options.path);
  if (!existsSync(spacePath)) {
    throw new SctxError('E_SPACE_PATH_MISSING', `Space path does not exist: ${spacePath}`);
  }

  const created = !existsSync(target);
  let config: { spaces?: SpaceConfig[]; schema?: string; [key: string]: unknown } = { spaces: [] };
  if (!created) {
    const raw = readFileSync(target, 'utf-8');
    try {
      config = JSON.parse(raw);
    } catch {
      const entry = { name: options.name, path: storedPath(target, spacePath), schema: options.schema };
      throw new SctxError(
        'E_CONFIG_NEEDS_MANUAL_EDIT',
        `${target} is not strict JSON (comments, trailing commas or a syntax error), so it was not rewritten. ` +
          `Add this entry to "spaces" by hand: ${JSON.stringify(entry)}`,
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
    if (!existsSync(resolveSchemaPath(options.schema, dirname(target)))) {
      const hint = options.schema.startsWith('sctx://')
        ? 'Name the schema by file, such as strategy_general.json, not by sctx:// URI.'
        : '`sctx schemas list` shows the bundled schemas; a file name needs its extension.';
      throw new SctxError('E_SCHEMA_NOT_FOUND', `Schema not found: ${options.schema}. ${hint}`);
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
