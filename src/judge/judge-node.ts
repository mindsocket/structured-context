import type { SpaceGraph } from '../space-graph';
import type { Rule, RuleSeverity, SpaceNode } from '../types';
import { judgeContext, type RuleContext, ruleContext } from './context';
import { type TrimReport, trimToCap } from './trim';
import type { SemanticJudgeInput, SemanticJudgeProvider } from './types';
import { isJudgeError, resolveSemanticRule } from './verdicts';

export type NodeJudgement = {
  rule: Rule;
  /** True when the verdict fails the rule (it has a severity), or the provider errored. */
  failed: boolean;
  /** Severity of the failing verdict; unset for a judge error, which takes the rule's own severity. */
  severity?: RuleSeverity;
  verdict?: string;
  /** User-facing guidance declared for the failing verdict. */
  guidance?: string;
  evidence?: string;
  /** Set when the judge could not produce a verdict for this rule. */
  error?: string;
};

type JudgeResults = Awaited<ReturnType<SemanticJudgeProvider['evaluate']>>;
type ResolvedRules = ReturnType<typeof resolveAll>;

function resolveAll(rules: Rule[]) {
  return rules.map(resolveSemanticRule);
}

function errorJudgements(rules: Rule[], message: string): NodeJudgement[] {
  return rules.map((rule) => ({
    rule,
    failed: true,
    evidence: `Error during evaluation: ${message}`,
    error: message,
  }));
}

function interpret(rules: Rule[], resolved: ResolvedRules, results: JudgeResults): NodeJudgement[] {
  return rules.map((rule, i) => {
    const result = results[rule.id];
    if (!result || isJudgeError(result)) {
      const message = result ? result.error : 'Model provider returned no result for this rule';
      return { rule, failed: true, evidence: `Error during evaluation: ${message}`, error: message };
    }
    const severity = resolved[i]!.severities[result.verdict];
    if (severity === undefined && !(result.verdict in resolved[i]!.spec.verdicts)) {
      const message = `Model provider returned unknown verdict "${result.verdict}" (allowed: ${Object.keys(resolved[i]!.spec.verdicts).join(', ')})`;
      return { rule, failed: true, evidence: `Error during evaluation: ${message}`, error: message };
    }
    const failed = severity !== undefined;
    return {
      rule,
      failed,
      severity,
      verdict: result.verdict,
      guidance: failed ? resolved[i]!.guidance[result.verdict] : undefined,
      evidence: result.evidence,
    };
  });
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reported for a node whose input is over the per-node input cap even with every body cut. */
const OVER_CAP_MESSAGE = 'input over the per-node cap after trimming content';

/**
 * One provider input and the rules (by position in their node's rule list) it answers. `trimmed` is set when
 * a body was cut to fit the per-node input cap; `overCap` when that was not enough, so the input is not sent.
 */
type Unit = {
  item: number;
  positions: number[];
  rules: Rule[];
  resolved: ResolvedRules;
  input: SemanticJudgeInput;
  trimmed: boolean;
  overCap: boolean;
};

/**
 * Split each node's rules into inputs by the context they ask for; rules that share a context share an input.
 * Each input is trimmed to the per-node input cap.
 */
function planUnits(graph: SpaceGraph, items: Array<{ node: SpaceNode; rules: Rule[] }>): Unit[] {
  const units: Unit[] = [];
  items.forEach(({ node, rules }, item) => {
    const groups = new Map<string, { context: RuleContext; positions: number[] }>();
    rules.forEach((rule, position) => {
      const context = ruleContext(rule);
      const key = `${context.content}|${context.scope.join(',')}`;
      const group = groups.get(key) ?? { context, positions: [] };
      group.positions.push(position);
      groups.set(key, group);
    });
    for (const { context, positions } of groups.values()) {
      const unitRules = positions.map((p) => rules[p]!);
      const resolved = resolveAll(unitRules);
      const { input, trimmed, overCap } = trimToCap(judgeContext(graph, node, context));
      units.push({
        item,
        positions,
        rules: unitRules,
        resolved,
        input: { ...input, rules: resolved.map((r) => r.spec) },
        trimmed,
        overCap,
      });
    }
  });
  return units;
}

/**
 * Judge several nodes at once. A judge with `evaluateNodes` gets every input in one call and may fold them into
 * fewer requests; any other judge is called once per input. A node's rules that share a context (related nodes
 * and bodies) form one input. An input over the per-node input cap has bodies trimmed; one still over is not sent
 * and marks its rules as errors. Trimmed nodes and rules are added to `report`. Results align with `items`, in
 * rule order. A failure marks only the affected rules as errors.
 */
export async function judgeNodes(
  judge: SemanticJudgeProvider,
  items: Array<{ node: SpaceNode; rules: Rule[] }>,
  graph: SpaceGraph,
  report?: TrimReport,
): Promise<NodeJudgement[][]> {
  const planned = planUnits(graph, items);
  const units = planned.filter((u) => !u.overCap);
  const out: NodeJudgement[][] = items.map(({ rules }) => new Array<NodeJudgement>(rules.length));
  const place = (unit: Unit, judgements: NodeJudgement[]) => {
    unit.positions.forEach((position, k) => {
      out[unit.item]![position] = judgements[k]!;
    });
  };

  for (const unit of planned) {
    if (unit.overCap) place(unit, errorJudgements(unit.rules, OVER_CAP_MESSAGE));
    else if (unit.trimmed && report) {
      report.nodes.add(items[unit.item]!.node.label);
      for (const rule of unit.rules) report.ruleIds.add(rule.id);
    }
  }

  if (!judge.evaluateNodes) {
    for (const unit of units) {
      try {
        place(unit, interpret(unit.rules, unit.resolved, await judge.evaluate(unit.input)));
      } catch (err) {
        place(unit, errorJudgements(unit.rules, errorMessage(err)));
      }
    }
    return out;
  }
  if (units.length === 0) return out;
  let perInput: JudgeResults[];
  try {
    perInput = await judge.evaluateNodes(units.map((u) => u.input));
  } catch (err) {
    for (const unit of units) place(unit, errorJudgements(unit.rules, errorMessage(err)));
    return out;
  }
  units.forEach((unit, k) => {
    place(unit, interpret(unit.rules, unit.resolved, perInput[k] ?? {}));
  });
  return out;
}
