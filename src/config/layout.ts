import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { LOCAL_CONFIG_FILE, RESOURCES_DIR, XDG_CONFIG_DIR } from '../constants';
import { SctxError } from '../errors';

const NESTED_CONFIG_FILE = 'config.json';

export const SCHEMAS_RESOURCE = 'schemas';

/** Path of the global config file, whether or not it exists. */
export function globalConfigPath(): string {
  const xdgBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(xdgBase, XDG_CONFIG_DIR, NESTED_CONFIG_FILE);
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** The config file that makes `dir` a config root, if any. */
export function configFileIn(dir: string): string | undefined {
  const beside = join(dir, LOCAL_CONFIG_FILE);
  const inside = join(dir, RESOURCES_DIR, NESTED_CONFIG_FILE);
  const found = [beside, inside].filter(isFile);
  if (found.length > 1) {
    throw new SctxError('E_CONFIG_AMBIGUOUS', `Both ${beside} and ${inside} exist. Keep one of them.`);
  }
  return found[0];
}

export function configRoot(configFile: string): string {
  const dir = dirname(resolve(configFile));
  return basename(dir) === RESOURCES_DIR && basename(configFile) === NESTED_CONFIG_FILE ? dirname(dir) : dir;
}

/** The folder holding one kind of resource (such as `plugins`) for a config root, if it exists. */
export function resourceDir(root: string, name: string): string | undefined {
  const absRoot = resolve(root);
  const dir = absRoot === dirname(globalConfigPath()) ? join(absRoot, name) : join(absRoot, RESOURCES_DIR, name);
  return existsSync(dir) && statSync(dir).isDirectory() ? dir : undefined;
}
