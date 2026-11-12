import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import JSON5 from 'json5';
import type { Config, SpaceConfig } from '../../src/config';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import type { SemanticJudgeProvider, SemanticJudgeResult } from '../../src/judge/types';
import { resolveSemanticRule } from '../../src/judge/verdicts';
import { resolvePluginDir } from '../../src/plugins/util';
import { readSpace } from '../../src/read/read-space';
import { resolveGraphEdges } from '../../src/read/resolve-graph-edges';
import { RESERVED_VERDICTS } from '../../src/schema/metadata-contract';
import { createSpaceContext } from '../../src/space-context';
import type { BaseNode, NodeId, ReadSpaceResult, SpaceContext } from '../../src/types';
import { validateNodes } from '../../src/validate';

/** Core's eval spaces, for the bundled schemas. */
export const CORE_EVALS_DIR = import.meta.dir;

/** Where a plugin keeps its eval spaces. */
export const EVALS_SUBDIR = join('evals', 'semantic');

/** Rule id → node id → the verdicts that count as agreeing. */
export type Expected = Record<string, Record<string, string[]>>;

/** A space and the verdict each of its nodes should get per rule. */
export interface EvalSpace {
  /** `<source>/<directory>`, e.g. `core/strict-ost`. */
  name: string;
  /** A fixture space has its own nodes, so every node a labelled rule judges must have a label. */
  fixture: boolean;
  context: SpaceContext;
  expected: Expected;
  /** The space's nodes, as validation reads them. */
  read: () => Promise<Pick<ReadSpaceResult, 'nodes' | 'unresolvedRefs' | 'unresolvedContentLinks'>>;
}

/** One verdict (or error) the judge gave for a node and rule. */
export interface Judgement {
  nodeId: string;
  ruleId: string;
  result: SemanticJudgeResult;
}

/** A directory of eval spaces, and the directory their schema names resolve from. */
export interface EvalSource {
  label: string;
  dir: string;
  configDir: string;
}

/**
 * Find a source: `core`, a plugin name (its `evals/semantic/`), or a path to a directory of eval spaces. A
 * plugin's schema names resolve as they would in the config that finds the plugin.
 */
export function resolveEvalSources(source: string, configDirs: string[]): EvalSource[] {
  if (source === 'core') return [{ label: 'core', dir: CORE_EVALS_DIR, configDir: CORE_EVALS_DIR }];
  if (source.includes('/') || source.includes('\\') || source.startsWith('.')) {
    const dir = resolve(source);
    if (!existsSync(dir)) throw new Error(`Eval source "${source}": no directory at ${dir}`);
    return [{ label: basename(dir), dir, configDir: dir }];
  }
  for (const configDir of configDirs) {
    const pluginDir = resolvePluginDir(source, configDir);
    if (pluginDir) {
      const dir = join(pluginDir, EVALS_SUBDIR);
      if (!existsSync(dir)) throw new Error(`Plugin "${source}" has no ${EVALS_SUBDIR}/ directory (${pluginDir})`);
      return [{ label: source, dir, configDir }];
    }
  }
  throw new Error(`Eval source "${source}" is not core, a path, or a plugin found from the config.`);
}

/**
 * An eval space's `eval.json5`. A fixture eval space names a `schema` (and optional `plugins`), as a space config
 * does, and keeps its nodes in `nodes.jsonl` beside the file, one schema object per line. An eval space on a
 * configured space names the `space` instead, and labels some of its nodes.
 */
type EvalFile = Pick<SpaceConfig, 'schema' | 'plugins'> & {
  space?: string;
  expected: Record<string, Record<string, string | string[]>>;
};

/** The eval spaces in each source: every directory with an `eval.json5`. `config` holds configured spaces. */
export function loadEvalSpaces(sources: EvalSource[], config: Config): EvalSpace[] {
  return sources.flatMap((source) =>
    readdirSync(source.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(source.dir, d.name, 'eval.json5')))
      .map((d) => d.name)
      .sort()
      .map((dirName) => {
        const name = `${source.label}/${dirName}`;
        const dir = join(source.dir, dirName);
        const file = JSON5.parse(readFileSync(join(dir, 'eval.json5'), 'utf8')) as EvalFile;
        if ((file.space === undefined) === (file.schema === undefined)) {
          throw new Error(`Eval space ${name}: eval.json5 needs either "schema" (with nodes.jsonl) or "space".`);
        }
        let context: SpaceContext;
        try {
          context =
            file.space !== undefined
              ? createSpaceContext(file.space, config)
              : createSpaceContext(
                  name,
                  { spaces: [{ name, path: dir, schema: file.schema, plugins: file.plugins }] },
                  { configDir: source.configDir },
                );
        } catch (err) {
          throw new Error(`Eval space ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const expected: Expected = {};
        for (const [ruleId, nodes] of Object.entries(file.expected)) {
          expected[ruleId] = Object.fromEntries(
            Object.entries(nodes).map(([id, v]) => [id, typeof v === 'string' ? [v] : v]),
          );
        }
        const read =
          file.space !== undefined
            ? () => readSpace(context)
            : async () => resolveGraphEdges(readNodes(join(dir, 'nodes.jsonl')), context.schema.metadata);
        return { name, fixture: file.space === undefined, context, expected, read };
      }),
  );
}

/**
 * Fixture nodes: one schema object per line, as frontmatter would hold it, with its `title` as the node id and
 * link target.
 */
function readNodes(path: string): BaseNode[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, i) => ({ line, at: `${path}:${i + 1}` }))
    .filter(({ line }) => line.trim() !== '')
    .map(({ line, at }) => {
      const schemaData = JSON.parse(line) as Record<string, unknown>;
      const { title, type } = schemaData;
      if (typeof title !== 'string' || typeof type !== 'string') throw new Error(`${at}: needs a "title" and a "type"`);
      return { id: title as NodeId, title, type, linkTargets: [title], schemaData };
    });
}

/**
 * Problems that would make an eval space's scores meaningless, checked before any judge call: a label naming an
 * unknown node, a rule with no semantic part, or a verdict the rule cannot return; a labelled node that fails
 * validation; and, in a fixture space, a node a labelled rule judges with no label, or a label never judged.
 */
export async function checkEvalSpace(space: EvalSpace): Promise<string[]> {
  const problems: string[] = [];
  const read = await space.read();
  const ids = new Set(read.nodes.map((n) => n.id as string));
  const labelled = new Set(Object.values(space.expected).flatMap((labels) => Object.keys(labels)));
  const result = await validateNodes(space.context, read.nodes, read);
  for (const issue of result.issues) {
    if (issue.severity === 'error' && issue.nodeId && labelled.has(issue.nodeId)) {
      problems.push(`${issue.nodeId}: ${issue.message}`);
    }
  }
  const rules = space.context.schema.metadata.rules ?? [];
  for (const [ruleId, labels] of Object.entries(space.expected)) {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule?.semantic) {
      problems.push(`rule "${ruleId}": not a semantic rule of the schema`);
      continue;
    }
    const verdicts = Object.keys(resolveSemanticRule(rule).spec.verdicts);
    for (const [nodeId, expected] of Object.entries(labels)) {
      if (!ids.has(nodeId)) problems.push(`rule "${ruleId}": unknown node "${nodeId}"`);
      for (const verdict of expected) {
        if (!verdicts.includes(verdict)) {
          problems.push(`rule "${ruleId}", node "${nodeId}": "${verdict}" is not a verdict (${verdicts.join(', ')})`);
        }
      }
    }
  }
  if (space.fixture && problems.length === 0) {
    const judge = new FakeJudgeProvider(({ node, rule }) => ({
      verdict: space.expected[rule.id]?.[node.id]?.[0] ?? Object.keys(rule.verdicts)[0]!,
    }));
    for (const score of scoreEvalSpace(space, [await judgeEvalSpace(space, judge, { unlabelled: true })])) {
      for (const nodeId of score.unlabelled) problems.push(`rule "${score.ruleId}": node "${nodeId}" has no label`);
      for (const { nodeId } of score.misses) problems.push(`rule "${score.ruleId}": node "${nodeId}" is not judged`);
    }
  }
  return problems.map((p) => `${space.name}: ${p}`);
}

type JudgeInput = Parameters<SemanticJudgeProvider['evaluate']>[0];

/**
 * Validate the space with its labelled rules through the real pipeline, recording every result the provider
 * returns, passing verdicts included. Gated nodes are judged too. Only labelled nodes reach the provider, unless
 * `unlabelled` is set. `perNode` hides `evaluateNodes`, so a provider that packs nodes into one request gets one
 * request per node instead.
 */
export async function judgeEvalSpace(
  space: EvalSpace,
  provider: SemanticJudgeProvider,
  options: { perNode?: boolean; unlabelled?: boolean } = {},
): Promise<Judgement[]> {
  const judgements: Judgement[] = [];
  const toJudge = (input: JudgeInput): JudgeInput | undefined => {
    if (options.unlabelled) return input;
    const rules = input.rules.filter((rule) => space.expected[rule.id]?.[input.node.id] !== undefined);
    return rules.length > 0 ? { ...input, rules } : undefined;
  };
  const record = (input: JudgeInput, results: Record<string, SemanticJudgeResult>) => {
    for (const rule of input.rules) {
      const result = results[rule.id] ?? { error: 'no result for this rule' };
      judgements.push({ nodeId: input.node.id, ruleId: rule.id, result });
    }
  };
  const recording: SemanticJudgeProvider = {
    name: provider.name,
    async evaluate(input) {
      const sent = toJudge(input);
      if (!sent) return {};
      const results = await provider.evaluate(sent);
      record(sent, results);
      return results;
    },
  };
  const { evaluateNodes } = provider;
  if (evaluateNodes && !options.perNode) {
    recording.evaluateNodes = async (inputs) => {
      const sent = inputs.map(toJudge);
      const kept = sent.filter((input) => input !== undefined);
      const results = kept.length > 0 ? await evaluateNodes.call(provider, kept) : [];
      let k = 0;
      return sent.map((input) => {
        if (!input) return {};
        const result = results[k++] ?? {};
        record(input, result);
        return result;
      });
    };
  }
  const read = await space.read();
  await validateNodes(space.context, read.nodes, read, {
    includeGated: true,
    ruleFilter: { id: Object.keys(space.expected) },
    judge: { provider: recording },
  });
  return judgements;
}

/** How well a provider's verdicts on one rule match the labels, over every run. */
export interface RuleScore {
  ruleId: string;
  cases: number;
  runs: number;
  /** Share of judgements, over cases and runs, whose verdict is an expected one. */
  agreement: number;
  /** Share of cases that got the same verdict on every run, with no errors. */
  stable: number;
  /** Mean probability given to the expected verdicts, over judgements that report probabilities. */
  expectedProbability?: number;
  /** Judgements with a reserved verdict, such as `missing-context`. */
  reserved: number;
  /** Cases that got an error, or no judgement, on some run. */
  errors: number;
  /** Cases where some run disagreed with the label, with the verdict (or error) each run gave. */
  misses: Array<{ nodeId: string; expected: string[]; got: string[]; evidence?: string }>;
  /** Nodes judged on this rule with no label. */
  unlabelled: string[];
}

const describe = (result: SemanticJudgeResult | undefined) =>
  !result ? 'not judged' : 'error' in result ? `error: ${result.error}` : result.verdict;

/** Score each labelled rule over the runs of one eval space with one provider. */
export function scoreEvalSpace(space: EvalSpace, runs: Judgement[][]): RuleScore[] {
  const reserved: readonly string[] = RESERVED_VERDICTS;
  return Object.entries(space.expected).map(([ruleId, labels]) => {
    const perRun = runs.map((run) => new Map(run.filter((j) => j.ruleId === ruleId).map((j) => [j.nodeId, j.result])));
    let agreeing = 0;
    let stable = 0;
    let errors = 0;
    let reservedCount = 0;
    const probabilities: number[] = [];
    const misses: RuleScore['misses'] = [];
    for (const [nodeId, expected] of Object.entries(labels)) {
      const results = perRun.map((run) => run.get(nodeId));
      const verdicts = results.map((r) => (r && !('error' in r) ? r.verdict : undefined));
      agreeing += verdicts.filter((v) => v !== undefined && expected.includes(v)).length;
      reservedCount += verdicts.filter((v) => v !== undefined && reserved.includes(v)).length;
      if (verdicts.includes(undefined)) errors++;
      else if (new Set(verdicts).size === 1) stable++;
      for (const r of results) {
        if (r && !('error' in r) && r.probabilities) {
          probabilities.push(expected.reduce((sum, v) => sum + (r.probabilities?.[v] ?? 0), 0));
        }
      }
      if (verdicts.some((v) => v === undefined || !expected.includes(v))) {
        const miss = results.find((r) => !r || 'error' in r || !expected.includes(r.verdict));
        misses.push({
          nodeId,
          expected,
          got: results.map(describe),
          ...(miss && !('error' in miss) && miss.evidence !== undefined && { evidence: miss.evidence }),
        });
      }
    }
    const cases = Object.keys(labels).length;
    const unlabelled = new Set(perRun.flatMap((run) => [...run.keys()]).filter((id) => !(id in labels)));
    return {
      ruleId,
      cases,
      runs: runs.length,
      agreement: cases && runs.length ? agreeing / (cases * runs.length) : 0,
      stable: cases ? stable / cases : 0,
      ...(probabilities.length > 0 && {
        expectedProbability: probabilities.reduce((a, b) => a + b, 0) / probabilities.length,
      }),
      reserved: reservedCount,
      errors,
      misses,
      unlabelled: [...unlabelled].sort(),
    };
  });
}
