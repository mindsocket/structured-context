import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import JSON5 from 'json5';
import type { Config, SpaceConfig } from '../src/config';
import { resolvePluginDir } from '../src/plugins/util';
import { readSpace } from '../src/read/read-space';
import { resolveGraphEdges } from '../src/read/resolve-graph-edges';
import { createSpaceContext } from '../src/space-context';
import type { BaseNode, SpaceContext } from '../src/types';

/** Where core and each plugin keep their semantic suite. */
export const SUITE_SUBDIR = join('evals', 'semantic');

/** The suite's fixtures: spaces whose nodes are in a JSONL file. */
const FIXTURES_FILE = 'fixtures.json5';

const CORE_SUITE_DIR = join(import.meta.dir, 'semantic');

/** A directory of evals and their fixtures, and the directory schema names resolve from. */
export interface Suite {
  name: string;
  dir: string;
  configDir: string;
}

/** Rule id → node id → the verdicts that count as agreeing. */
export type Expected = Record<string, Record<string, string[]>>;

/** Labelled cases on the nodes of one space: a fixture, or a configured space. */
export interface Eval {
  /** `<suite>/<file name>`, e.g. `core/opportunity-customer-voice`. */
  name: string;
  context: SpaceContext;
  expected: Expected;
  read: () => Promise<ReturnType<typeof resolveGraphEdges>>;
}

/** `core`, a plugin name, or a path to a suite directory. */
export function resolveSuite(source: string, configDirs: string[]): Suite {
  if (source === 'core') return { name: 'core', dir: CORE_SUITE_DIR, configDir: CORE_SUITE_DIR };
  if (source.includes('/') || source.includes('\\') || source.startsWith('.')) {
    const dir = resolve(source);
    if (!existsSync(dir)) throw new Error(`Suite "${source}": no directory at ${dir}`);
    return { name: basename(dir), dir, configDir: dir };
  }
  for (const configDir of configDirs) {
    const pluginDir = resolvePluginDir(source, configDir);
    if (!pluginDir) continue;
    const dir = join(pluginDir, SUITE_SUBDIR);
    if (!existsSync(dir)) throw new Error(`Plugin "${source}" has no ${SUITE_SUBDIR}/ directory (${pluginDir})`);
    return { name: source, dir, configDir };
  }
  throw new Error(`Suite "${source}" is not core, a path, or a plugin found from the config.`);
}

type EvalFile = { space: string; expected: Record<string, Record<string, string | string[]>> };
type FixturesFile = { spaces: Pick<SpaceConfig, 'name' | 'path' | 'schema' | 'plugins'>[] };
type Space = Pick<Eval, 'context' | 'read'>;

/**
 * Every `*.json5` at the top of each suite, except `fixtures.json5`, is an eval. An eval's `space` names one of
 * the suite's fixtures, or else a space in `config`.
 */
export function loadEvals(suites: Suite[], config: Config): Eval[] {
  return suites.flatMap((suite) => {
    const fixtures = loadFixtures(suite);
    return readdirSync(suite.dir)
      .filter((file) => file.endsWith('.json5') && file !== FIXTURES_FILE)
      .sort()
      .map((file) => {
        const name = `${suite.name}/${basename(file, '.json5')}`;
        try {
          const { space, expected: labels } = JSON5.parse(readFileSync(join(suite.dir, file), 'utf8')) as EvalFile;
          if (typeof space !== 'string') throw new Error('needs a "space"');
          const expected: Expected = {};
          for (const [ruleId, verdicts] of Object.entries(labels)) {
            expected[ruleId] = Object.fromEntries(Object.entries(verdicts).map(([id, v]) => [id, [v].flat()]));
          }
          return { name, expected, ...(fixtures.get(space) ?? configuredSpace(space, config)) };
        } catch (err) {
          throw new Error(`Eval ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
  });
}

function configuredSpace(name: string, config: Config): Space {
  const context = createSpaceContext(name, config);
  return { context, read: () => readSpace(context) };
}

/** A fixture's nodes file holds one parsed node per line, as `sctx dump` prints them. Resolved fields are dropped, since resolution runs again. */
function loadFixtures(suite: Suite): Map<string, Space> {
  const path = join(suite.dir, FIXTURES_FILE);
  if (!existsSync(path)) return new Map();
  const { spaces } = JSON5.parse(readFileSync(path, 'utf8')) as FixturesFile;
  const config: Config = { spaces: spaces.map((s) => ({ ...s, path: resolve(suite.dir, s.path) })) };
  return new Map(
    config.spaces.map(({ name, path: nodesPath }) => {
      const context = createSpaceContext(name, config, { configDir: suite.configDir });
      const nodes = readNodes(nodesPath);
      return [name, { context, read: async () => resolveGraphEdges(nodes, context.schema.metadata) }];
    }),
  );
}

function readNodes(path: string): BaseNode[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      if (line.trim() === '') return [];
      const { id, title, type, schemaData, linkTargets, content, contentLinks } = JSON.parse(line) as BaseNode;
      if (!id || typeof title !== 'string' || typeof type !== 'string' || !schemaData || !linkTargets) {
        throw new Error(`${path}:${i + 1}: not a parsed node (needs id, title, type, schemaData and linkTargets)`);
      }
      return [{ id, title, type, schemaData, linkTargets, content, contentLinks }];
    });
}
