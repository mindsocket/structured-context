import type { NodeJudgement } from '../judge/judge-node';
import { judgeNodes } from '../judge/judge-node';
import type { TrimReport } from '../judge/trim';
import type { SemanticJudgeProvider } from '../judge/types';
import type { SpaceGraph } from '../space-graph';
import type { Rule, RuleSeverity, RuleViolation, SpaceNode } from '../types';
import {
  buildEvalContext,
  evaluateRuleExpression,
  expressionErrorViolation,
  tryEvaluateExpression,
} from './evaluate-rule';
import { ruleSeverities, ruleSeverity } from './rule-severity';

/**
 * Whether a violation of this rule gates its subtree: explicit `gatesDescendants`, else true only for `error` severity.
 * `severity` is that of the violation: the rule's own for an expression, the verdict's for a semantic part.
 */
export function ruleGatesDescendants(rule: Rule, severity: RuleSeverity = ruleSeverity(rule)): boolean {
  return rule.gatesDescendants ?? severity === 'error';
}

/** Whether any violation of this rule could gate its subtree. */
function ruleCanGate(rule: Rule): boolean {
  return rule.gatesDescendants ?? ruleSeverities(rule).includes('error');
}

/**
 * A node-level failure that seeds cascade gating: a deterministic, always-run check
 * (schema validation or hierarchy structure) that failed on a specific node.
 */
export type GatingSeed = {
  /** Label (file) of the failing node. */
  file: string;
  /** Title of the failing node. */
  title: string;
  /** Which always-run layer produced the failure. */
  reason: 'schema' | 'hierarchy';
};

/**
 * Records one cascade: a node whose failure or blocking rule violation suppressed
 * rule evaluation for itself (if schema/hierarchy caused it) and/or its hierarchy subtree.
 */
export type CoverageGate = {
  /** Label (file) of the node whose failure triggered this gate. */
  file: string;
  /** Title of the blocking node. */
  nodeTitle: string;
  /** What kind of check triggered the gate. */
  reason: 'schema' | 'hierarchy' | 'rule';
  /** Rule id responsible, when `reason` is `'rule'`. */
  ruleId?: string;
  /** Labels of nodes whose rule evaluation was suppressed as a result of this gate. */
  gatedFiles: string[];
};

export type GatedRuleEvaluation = {
  violations: RuleViolation[];
  gates: CoverageGate[];
};

export interface GatingOptions {
  trimReport?: TrimReport;
  /** Evaluate rules on gated nodes anyway (gates are still reported). */
  includeGated?: boolean;
  /** Evaluates `semantic` rules. Without it, a rule's semantic part is not evaluated. */
  provider?: SemanticJudgeProvider;
  /**
   * Label of the one node whose result is wanted (`validate-file`). Gating is still computed over the
   * whole space, but the judge is only consulted for that node and for its hierarchy ancestors' gate-capable
   * semantic rules (top-down, so a gated ancestor stops the walk). Other nodes' semantic rules are not evaluated.
   */
  judgeTarget?: string;
}

/**
 * Compute breadth-first depth (1-based, from hierarchy roots and orphans) for every
 * hierarchy-typed node in the graph. Non-hierarchy nodes are not included.
 */
export function computeHierarchyDepths(graph: SpaceGraph): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: Array<{ title: string; depth: number }> = [];
  for (const node of [...graph.hierarchyRoots, ...graph.orphans]) {
    queue.push({ title: node.title, depth: 1 });
  }

  let i = 0;
  while (i < queue.length) {
    const { title, depth } = queue[i++]!;
    if (depths.has(title)) continue;
    depths.set(title, depth);
    for (const child of graph.hierarchyChildren.get(title) ?? []) {
      if (!depths.has(child.title)) queue.push({ title: child.title, depth: depth + 1 });
    }
  }

  return depths;
}

/**
 * Evaluate executable rules with cascade gating: a schema, hierarchy, or blocking-rule
 * failure on a node suppresses rule evaluation for that node (when the failure is
 * schema/hierarchy) and its hierarchy subtree, unless `includeGated` is set.
 *
 * Traversal is breadth-first from hierarchy roots and orphans. Non-hierarchy nodes
 * (not part of the hierarchy DAG) are always evaluated — cascade gating only applies
 * within hierarchy subtrees. Global rules always run, unaffected by gating.
 */
export async function evaluateRulesWithGating(
  nodes: SpaceNode[],
  rules: Rule[],
  graph: SpaceGraph,
  seeds: GatingSeed[],
  options: GatingOptions = {},
): Promise<GatedRuleEvaluation> {
  const includeGated = options.includeGated ?? false;

  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    if (node.title) nodeIndex.set(node.title, node);
  }

  // When a node has both a schema and hierarchy failure, report schema as the reason.
  const seedByTitle = new Map<string, GatingSeed>();
  for (const seed of seeds) {
    if (!seedByTitle.has(seed.title) || seed.reason === 'schema') {
      seedByTitle.set(seed.title, seed);
    }
  }

  const judge = options.provider;
  const violations: RuleViolation[] = [];
  const gateOrigins = new Map<string, CoverageGate>();

  function originFor(
    title: string,
    seed: { file: string; reason: CoverageGate['reason']; ruleId?: string },
  ): CoverageGate {
    let origin = gateOrigins.get(title);
    if (!origin) {
      origin = { file: seed.file, nodeTitle: title, reason: seed.reason, ruleId: seed.ruleId, gatedFiles: [] };
      gateOrigins.set(title, origin);
    }
    return origin;
  }

  const globalRules = rules.filter((r) => r.global && r.expression !== undefined);
  const sentinel = nodes[0];
  if (sentinel) {
    for (const rule of globalRules) {
      const result = await evaluateRuleExpression(rule, sentinel, nodes, nodeIndex, '');
      if (!result.passed) violations.push(result.violation);
    }
  }

  const perNodeRules = rules.filter(
    (r) => !r.global && (r.expression !== undefined || (r.semantic !== undefined && judge)),
  );

  // With a judge target, only the target and its hierarchy ancestors can need judging.
  const targetAncestors = new Set<string>();
  if (options.judgeTarget !== undefined) {
    const parentsOf = new Map<string, string[]>();
    for (const [parent, children] of graph.hierarchyChildren) {
      for (const child of children) parentsOf.set(child.title, [...(parentsOf.get(child.title) ?? []), parent]);
    }
    const target = nodes.find((n) => n.label === options.judgeTarget);
    const pending = target ? [target.title] : [];
    while (pending.length > 0) {
      for (const parent of parentsOf.get(pending.pop()!) ?? []) {
        if (!targetAncestors.has(parent)) {
          targetAncestors.add(parent);
          pending.push(parent);
        }
      }
    }
  }

  /** Rules that apply to this node: matching `type`, passing their `when` test, and (for a judge target) worth judging. */
  async function applicableRules(node: SpaceNode, onWhenError?: (rule: Rule, error: string) => void): Promise<Rule[]> {
    const applicable: Rule[] = [];
    for (const r of perNodeRules) {
      if (r.type && r.type !== node.resolvedType) continue;
      if (
        judge &&
        r.semantic !== undefined &&
        options.judgeTarget !== undefined &&
        node.label !== options.judgeTarget
      ) {
        // Ancestors only matter through the gates they could raise.
        if (!(targetAncestors.has(node.title) && ruleCanGate(r))) continue;
      }
      if (r.when) {
        const outcome = await tryEvaluateExpression(r.when, buildEvalContext(node, nodes, nodeIndex));
        if ('error' in outcome) {
          onWhenError?.(r, outcome.error);
          continue;
        }
        if (outcome.value !== true) continue;
      }
      applicable.push(r);
    }
    return applicable;
  }

  /** A node whose expressions have run and whose semantic parts await the judge. */
  type PreparedNode = {
    violations: RuleViolation[];
    semantic: Rule[];
    blockingRuleId?: string;
    judged(judgements: NodeJudgement[]): void;
  };

  async function prepareNode(node: SpaceNode): Promise<PreparedNode> {
    const local: RuleViolation[] = [];
    const prepared: PreparedNode = { violations: local, semantic: [], judged: () => {} };
    const applicable = await applicableRules(node, (rule, error) =>
      local.push(expressionErrorViolation(rule, node.label, error)),
    );

    function report(
      rule: Rule,
      detail: { severity?: RuleSeverity; verdict?: string; guidance?: string; evidence?: string; error?: string } = {},
    ): void {
      const severity = detail.severity ?? ruleSeverities(rule)[0] ?? ruleSeverity(rule);
      local.push({
        file: node.label,
        ruleId: rule.id,
        category: rule.category,
        severity,
        description: detail.error
          ? `${rule.description} (Semantic evaluation error: ${detail.error})`
          : rule.description,
        ...(detail.evidence !== undefined && { evidence: detail.evidence }),
        ...(detail.verdict !== undefined && { verdict: detail.verdict }),
        ...(detail.guidance !== undefined && { guidance: detail.guidance }),
      });
      // An evaluation error says nothing about the node, so it never gates.
      if (!detail.error && ruleGatesDescendants(rule, severity) && !prepared.blockingRuleId) {
        prepared.blockingRuleId = rule.id;
      }
    }

    // Cheap expressions first. A semantic part is evaluated only when its own expression passes, and not at all
    // on a node with a gating violation.
    const semantic: Rule[] = [];
    for (const rule of applicable) {
      if (rule.expression !== undefined) {
        const result = await evaluateRuleExpression(rule, node, nodes, nodeIndex);
        if (!result.passed) {
          local.push(result.violation);
          if (result.failed && ruleGatesDescendants(rule, result.violation.severity) && !prepared.blockingRuleId) {
            prepared.blockingRuleId = rule.id;
          }
          continue;
        }
      }
      if (rule.semantic !== undefined && judge) semantic.push(rule);
    }
    if (!prepared.blockingRuleId) prepared.semantic = semantic;
    prepared.judged = (judgements) => {
      for (const j of judgements) {
        if (j.failed) {
          report(j.rule, {
            severity: j.severity,
            verdict: j.verdict,
            guidance: j.guidance,
            evidence: j.evidence,
            error: j.error,
          });
        }
      }
    };
    return prepared;
  }

  /**
   * Evaluate one set of nodes together, so their semantic rules go to the judge in one pass and a judge
   * with `evaluateNodes` can share model calls. Gating for the set is already decided; violations are
   * recorded in node order.
   */
  async function evaluateNodeSet(nodes: readonly SpaceNode[]): Promise<Array<{ blockingRuleId?: string }>> {
    const prepared: PreparedNode[] = [];
    for (const node of nodes) prepared.push(await prepareNode(node));
    if (judge) {
      const pending = nodes.map((node, i) => ({ node, rules: prepared[i]!.semantic }));
      const judgements = await judgeNodes(judge, pending, graph, options.trimReport);
      prepared.forEach((p, i) => {
        p.judged(judgements[i] ?? []);
      });
    }
    for (const p of prepared) violations.push(...p.violations);
    return prepared.map((p) => ({ blockingRuleId: p.blockingRuleId }));
  }

  // Non-hierarchy nodes sit outside the subtree cascade — always evaluated, never gated.
  await evaluateNodeSet(graph.nonHierarchy);

  const visited = new Set<string>();
  // Hierarchy nodes are judged one depth at a time: a node's verdicts decide whether its children are evaluated.
  let depthNodes: Array<{ node: SpaceNode; ancestorOrigin?: string }> = [];
  for (const node of [...graph.hierarchyRoots, ...graph.orphans]) {
    depthNodes.push({ node, ancestorOrigin: undefined });
  }

  while (depthNodes.length > 0) {
    const current: typeof depthNodes = [];
    for (const entry of depthNodes) {
      if (visited.has(entry.node.title)) continue;
      visited.add(entry.node.title);
      current.push(entry);
    }
    const isGated = (e: (typeof depthNodes)[number]) => e.ancestorOrigin !== undefined || seedByTitle.has(e.node.title);
    const toEvaluate = current.filter((e) => !isGated(e) || includeGated);
    const evaluated = await evaluateNodeSet(toEvaluate.map((e) => e.node));
    const blockingByTitle = new Map(toEvaluate.map((e, i) => [e.node.title, evaluated[i]!.blockingRuleId]));

    const next: typeof depthNodes = [];
    for (const { node, ancestorOrigin } of current) {
      const selfSeed = seedByTitle.get(node.title);
      const isGatedByAncestor = ancestorOrigin !== undefined;
      const isSelfBlocked = selfSeed !== undefined;
      const blockingRuleId = blockingByTitle.get(node.title);

      let childOrigin: string | undefined = ancestorOrigin;
      if (isGatedByAncestor) {
        gateOrigins.get(ancestorOrigin!)!.gatedFiles.push(node.label);
      } else if (isSelfBlocked) {
        const origin = originFor(node.title, { file: selfSeed!.file, reason: selfSeed!.reason });
        origin.gatedFiles.push(node.label);
        childOrigin = node.title;
      } else if (blockingRuleId) {
        originFor(node.title, { file: node.label, reason: 'rule', ruleId: blockingRuleId });
        childOrigin = node.title;
      } else {
        childOrigin = undefined;
      }

      for (const child of graph.hierarchyChildren.get(node.title) ?? []) {
        next.push({ node: child, ancestorOrigin: childOrigin });
      }
    }
    depthNodes = next;
  }

  return {
    violations,
    gates: [...gateOrigins.values()].filter((g) => g.gatedFiles.length > 0),
  };
}
