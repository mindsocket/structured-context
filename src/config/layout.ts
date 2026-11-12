import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { LOCAL_CONFIG_FILE, RESOURCES_DIR, XDG_CONFIG_DIR } from '../constants';
import { SctxError } from '../errors';

/** The config file inside a resources folder: `.sctx/config.json`, or the global `config.json`. */
const NESTED_CONFIG_FILE = 'config.json';

/** Resource folder for schemas the config's spaces name by file name. */
export const SCHEMAS_RESOURCE = 'schemas';

/** Resource folders that used to sit directly beside the config, before the resources folder. */
const LEGACY_RESOURCES = new Set(['plugins', 'map-views']);

/** Path of the global config file, whether or not it exists. */
export function globalConfigPath(): string {
  const xdgBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(xdgBase, XDG_CONFIG_DIR, NESTED_CONFIG_FILE);
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** The config file that makes `dir` a root, if any. Throws when both forms exist. */
export function configFileIn(dir: string): string | undefined {
  const beside = join(dir, LOCAL_CONFIG_FILE);
  const inside = join(dir, RESOURCES_DIR, NESTED_CONFIG_FILE);
  const found = [beside, inside].filter(isFile);
  if (found.length > 1) {
    throw new SctxError('E_CONFIG_AMBIGUOUS', `Both ${beside} and ${inside} exist. Keep one of them.`);
  }
  return found[0];
}

/** The root of a config file: the folder its relative paths resolve from, and where its resources are found. */
export function configRoot(configFile: string): string {
  const dir = dirname(resolve(configFile));
  return basename(dir) === RESOURCES_DIR && basename(configFile) === NESTED_CONFIG_FILE ? dirname(dir) : dir;
}

const warnedLegacy = new Set<string>();

/**
 * The folder holding one kind of resource (such as `plugins`) for a root, or undefined when there is none.
 * A root's resources sit in its `.sctx/` folder; the global config's sit beside it. A `plugins/` or
 * `map-views/` folder directly in a local root still works, with a warning.
 */
export function resourceDir(root: string, name: string): string | undefined {
  const absRoot = resolve(root);
  if (absRoot === dirname(globalConfigPath())) {
    const dir = join(absRoot, name);
    return isDirectory(dir) ? dir : undefined;
  }
  const dir = join(absRoot, RESOURCES_DIR, name);
  if (isDirectory(dir)) return dir;
  const legacy = join(absRoot, name);
  if (!LEGACY_RESOURCES.has(name) || !isDirectory(legacy)) return undefined;
  if (!warnedLegacy.has(legacy)) {
    warnedLegacy.add(legacy);
    console.warn(`Warning: ${legacy} is deprecated and will stop working in 1.0; move it to ${dir}.`);
  }
  return legacy;
}
