import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import JSON5 from 'json5';
import type { Config, SpaceConfig } from '../src/config';
import { resolvePluginDir } from '../src/plugins/util';
import { readSpace } from '../src/read/read-space';
import { resolveGraphEdges } from '../src/read/resolve-graph-edges';
import { createSpaceContext } from '../src/space-context';
import type { BaseNode, NodeId, SpaceContext } from '../src/types';

/** Where core and each plugin keep their semantic suite. */
export const SUITE_SUBDIR = join('evals', 'semantic');

const CORE_SUITE_DIR = join(import.meta.dir, 'semantic');

/** A directory of evals and their fixtures, and the directory schema names resolve from. */
export interface Suite {
  name: string;
  dir: string;
  configDir: string;
}

/** Rule id → node id → the verdicts that count as agreeing. */
export type Expected = Record<string, Record<string, string[]>>;

/** Labelled cases on the nodes of one fixture or configured space. */
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

type EvalFile = { fixture?: string; space?: string; expected: Record<string, Record<string, string | string[]>> };
type FixtureFile = Pick<SpaceConfig, 'schema' | 'plugins'> & { nodes: Record<string, unknown>[] };

/** Every `*.json5` at the top of each suite is an eval. `config` holds the spaces evals name. */
export function loadEvals(suites: Suite[], config: Config): Eval[] {
  return suites.flatMap((suite) => {
    const fixtures = new Map<string, Pick<Eval, 'context' | 'read'>>();
    const fixture = (name: string) => {
      if (!fixtures.has(name)) fixtures.set(name, loadFixture(suite, name));
      return fixtures.get(name)!;
    };
    return readdirSync(suite.dir)
      .filter((file) => file.endsWith('.json5'))
      .sort()
      .map((file) => {
        const name = `${suite.name}/${basename(file, '.json5')}`;
        try {
          const evalFile = JSON5.parse(readFileSync(join(suite.dir, file), 'utf8')) as EvalFile;
          if ((evalFile.fixture === undefined) === (evalFile.space === undefined)) {
            throw new Error('needs either "fixture" or "space"');
          }
          const expected: Expected = {};
          for (const [ruleId, labels] of Object.entries(evalFile.expected)) {
            expected[ruleId] = Object.fromEntries(Object.entries(labels).map(([id, v]) => [id, [v].flat()]));
          }
          if (evalFile.fixture !== undefined) return { name, expected, ...fixture(evalFile.fixture) };
          const context = createSpaceContext(evalFile.space!, config);
          return { name, expected, context, read: () => readSpace(context) };
        } catch (err) {
          throw new Error(`Eval ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
  });
}

/** `fixtures/<name>.json5`: a schema and the nodes' schema data, each with its `title` as node id and link target. */
function loadFixture(suite: Suite, name: string): Pick<Eval, 'context' | 'read'> {
  const path = join(suite.dir, 'fixtures', `${name}.json5`);
  if (!existsSync(path)) throw new Error(`no fixture at ${path}`);
  const file = JSON5.parse(readFileSync(path, 'utf8')) as FixtureFile;
  const spaceName = `${suite.name}/fixtures/${name}`;
  const context = createSpaceContext(
    spaceName,
    { spaces: [{ name: spaceName, path: suite.dir, schema: file.schema, plugins: file.plugins }] },
    { configDir: suite.configDir },
  );
  const nodes: BaseNode[] = file.nodes.map((schemaData, i) => {
    const { title, type } = schemaData;
    if (typeof title !== 'string' || typeof type !== 'string') {
      throw new Error(`${path}: node ${i + 1} needs a "title" and a "type"`);
    }
    return { id: title as NodeId, title, type, linkTargets: [title], schemaData };
  });
  return { context, read: async () => resolveGraphEdges(nodes, context.schema.metadata) };
}
