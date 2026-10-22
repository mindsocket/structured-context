import type { SpaceGraph } from '../space-graph';
import type { Rule, RuleSeverity, SpaceNode } from '../types';
import { judgeContext, type RuleContext, ruleContext } from './context';
import { type TrimReport, trimToCap } from './trim';
import type { SemanticJudgeInput, SemanticJudgeProvider } from './types';
import { isJudgeError, resolveSemanticRule } from './verdicts';

export type NodeJudgement = {
  rule: Rule;
  /** True when the verdict has a severity (so it reports a violation), or the provider errored. */
  violated: boolean;
  /** Severity of the verdict; unset for a judge error, which takes the rule's own severity. */
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
    violated: true,
    evidence: `Error during evaluation: ${message}`,
    error: message,
  }));
}

function interpret(rules: Rule[], resolved: ResolvedRules, results: JudgeResults): NodeJudgement[] {
  return rules.map((rule, i) => {
    const result = results[rule.id];
    if (!result || isJudgeError(result)) {
      const message = result ? result.error : 'Model provider returned no result for this rule';
      return { rule, violated: true, evidence: `Error during evaluation: ${message}`, error: message };
    }
    const severity = resolved[i]!.severities[result.verdict];
    if (severity === undefined && !(result.verdict in resolved[i]!.spec.verdicts)) {
      const message = `Model provider returned unknown verdict "${result.verdict}" (allowed: ${Object.keys(resolved[i]!.spec.verdicts).join(', ')})`;
      return { rule, violated: true, evidence: `Error during evaluation: ${message}`, error: message };
    }
    const violated = severity !== undefined;
    return {
      rule,
      violated,
      severity,
      verdict: result.verdict,
      guidance: violated ? resolved[i]!.guidance[result.verdict] : undefined,
      evidence: result.evidence,
    };
  });
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const OVER_CAP_MESSAGE = 'input over the per-node cap after trimming content';

/** Rules (by position in their node's rule list) of one node that share an input. */
type Slot = { item: number; positions: number[]; rules: Rule[] };
/** One provider input and the rules it answers. */
type Unit = Slot & { resolved: ResolvedRules; input: SemanticJudgeInput };

/**
 * Split each node's rules into inputs by the context they ask for, trimmed to the per-node input cap; rules that
 * share a context share an input. Inputs that cannot fit go to `overCap`; trimmed ones are added to `report`.
 */
function planUnits(
  graph: SpaceGraph,
  items: Array<{ node: SpaceNode; rules: Rule[] }>,
  report?: TrimReport,
): { units: Unit[]; overCap: Slot[] } {
  const units: Unit[] = [];
  const overCap: Slot[] = [];
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
      const fitted = trimToCap(judgeContext(graph, node, context));
      if (!fitted) {
        overCap.push({ item, positions, rules: unitRules });
        continue;
      }
      if (fitted.trimmed && report) {
        report.nodes.add(node.id);
        for (const rule of unitRules) report.ruleIds.add(rule.id);
      }
      units.push({
        item,
        positions,
        rules: unitRules,
        resolved,
        input: { ...fitted.input, rules: resolved.map((r) => r.spec) },
      });
    }
  });
  return { units, overCap };
}

/**
 * Judge several nodes at once. A judge with `evaluateNodes` gets every input in one call and may fold them into
 * fewer requests; any other judge is called once per input. A node's rules that share a context (related nodes
 * and bodies) form one input; an input that cannot fit the per-node input cap is not sent. Results align with
 * `items`, in rule order. A failure marks only the affected rules as errors.
 */
export async function judgeNodes(
  judge: SemanticJudgeProvider,
  items: Array<{ node: SpaceNode; rules: Rule[] }>,
  graph: SpaceGraph,
  report?: TrimReport,
): Promise<NodeJudgement[][]> {
  const { units, overCap } = planUnits(graph, items, report);
  const out: NodeJudgement[][] = items.map(({ rules }) => new Array<NodeJudgement>(rules.length));
  const place = (unit: Slot, judgements: NodeJudgement[]) => {
    unit.positions.forEach((position, k) => {
      out[unit.item]![position] = judgements[k]!;
    });
  };

  for (const slot of overCap) place(slot, errorJudgements(slot.rules, OVER_CAP_MESSAGE));

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
