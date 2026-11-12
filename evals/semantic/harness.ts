import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSON5 from 'json5';
import type { Config } from '../../src/config';
import type { SemanticJudgeProvider, SemanticJudgeResult } from '../../src/judge/types';
import { resolveSemanticRule } from '../../src/judge/verdicts';
import { readSpace } from '../../src/read/read-space';
import { RESERVED_VERDICTS } from '../../src/schema/metadata-contract';
import { createSpaceContext } from '../../src/space-context';
import type { SpaceContext } from '../../src/types';
import { validateNodes } from '../../src/validate';

export const EVALS_DIR = import.meta.dir;

/** Rule id → node id → the verdicts that count as agreeing. */
export type Expected = Record<string, Record<string, string[]>>;

/** A fixture space and the verdict each of its nodes should get per rule. */
export interface EvalSpace {
  name: string;
  context: SpaceContext;
  expected: Expected;
}

/** One verdict (or error) the judge gave for a node and rule. */
export interface Judgement {
  nodeId: string;
  ruleId: string;
  result: SemanticJudgeResult;
}

type EvalFile = { schema: string; expected: Record<string, Record<string, string | string[]>> };

/** The eval spaces under `root`: each directory with an `eval.json5` beside a `space/` directory. */
export function loadEvalSpaces(root: string = EVALS_DIR, only?: string[]): EvalSpace[] {
  const names = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!only || only.includes(d.name)))
    .map((d) => d.name)
    .sort();
  const unknown = only?.filter((name) => !names.includes(name)) ?? [];
  if (unknown.length > 0) throw new Error(`Unknown eval space: ${unknown.join(', ')}. Known: ${names.join(', ')}`);
  return names.map((name) => {
    const dir = join(root, name);
    const file = JSON5.parse(readFileSync(join(dir, 'eval.json5'), 'utf8')) as EvalFile;
    const config: Config = { spaces: [{ name, path: join(dir, 'space'), schema: file.schema }] };
    const expected: Expected = {};
    for (const [ruleId, nodes] of Object.entries(file.expected)) {
      expected[ruleId] = Object.fromEntries(
        Object.entries(nodes).map(([id, v]) => [id, typeof v === 'string' ? [v] : v]),
      );
    }
    return { name, context: createSpaceContext(name, config, { configDir: dir }), expected };
  });
}

/**
 * Problems that would make an eval space's scores meaningless: an invalid space (gating and schema failures
 * change what is judged), or a label naming an unknown node, a rule with no semantic part, or a verdict the
 * rule cannot return. Checked before any judge call.
 */
export async function checkEvalSpace(space: EvalSpace): Promise<string[]> {
  const problems: string[] = [];
  const read = await readSpace(space.context);
  const result = await validateNodes(space.context, read.nodes, read);
  for (const issue of result.issues) {
    if (issue.severity === 'error') problems.push(`${issue.nodeId ?? ''}: ${issue.message}`);
  }
  const ids = new Set(read.nodes.map((n) => n.id as string));
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
  return problems.map((p) => `${space.name}: ${p}`);
}

/**
 * Validate the space with its labelled rules through the real pipeline, recording every result the provider
 * returns, passing verdicts included. Gated nodes are judged too. `perNode` hides `evaluateNodes`, so a
 * provider that packs nodes into one request gets one request per node instead.
 */
export async function judgeEvalSpace(
  space: EvalSpace,
  provider: SemanticJudgeProvider,
  options: { perNode?: boolean } = {},
): Promise<Judgement[]> {
  const judgements: Judgement[] = [];
  const record = (
    input: Parameters<SemanticJudgeProvider['evaluate']>[0],
    results: Record<string, SemanticJudgeResult>,
  ) => {
    for (const rule of input.rules) {
      const result = results[rule.id] ?? { error: 'no result for this rule' };
      judgements.push({ nodeId: input.node.id, ruleId: rule.id, result });
    }
  };
  const recording: SemanticJudgeProvider = {
    name: provider.name,
    async evaluate(input) {
      const results = await provider.evaluate(input);
      record(input, results);
      return results;
    },
  };
  const { evaluateNodes } = provider;
  if (evaluateNodes && !options.perNode) {
    recording.evaluateNodes = async (inputs) => {
      const results = await evaluateNodes.call(provider, inputs);
      for (const [i, input] of inputs.entries()) record(input, results[i] ?? {});
      return results;
    };
  }
  const read = await readSpace(space.context);
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
