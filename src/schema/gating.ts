import { judgeNode } from '../judge/judge-node';
import type { GatedRuleRecord, SemanticEvaluationRecord, SemanticJudgeProvider } from '../judge/types';
import type { SpaceGraph } from '../space-graph';
import type { Rule, RuleViolation, SpaceNode } from '../types';
import { buildEvalContext, evaluateExpression } from './evaluate-rule';
import { ruleSeverity } from './validate-rules';

/** Whether a violation of this rule gates its subtree: explicit `gatesDescendants`, else true only for `error` severity. */
export function ruleGatesDescendants(rule: Rule): boolean {
  return rule.gatesDescendants ?? ruleSeverity(rule) === 'error';
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
  /** Semantic judgements made (empty unless a judge was supplied). */
  semanticEvaluations: SemanticEvaluationRecord[];
  /** Semantic rule/node pairs skipped because the node was gated (empty unless a judge was supplied). */
  gatedRules: GatedRuleRecord[];
};

export interface GatingOptions {
  /** Evaluate rules on gated nodes anyway (gates are still reported). */
  includeGated?: boolean;
  /** Judge for `mode: semantic` rules. Without it, semantic rules are not evaluated. */
  judge?: SemanticJudgeProvider;
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
 * within hierarchy subtrees. Global-scope rules always run, unaffected by gating.
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

  const judge = options.judge;
  const violations: RuleViolation[] = [];
  const semanticEvaluations: SemanticEvaluationRecord[] = [];
  const gatedRules: GatedRuleRecord[] = [];
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

  const globalRules = rules.filter((r) => r.scope === 'global' && r.mode !== 'semantic');
  const sentinel = nodes[0];
  if (sentinel) {
    for (const rule of globalRules) {
      const context = buildEvalContext(sentinel, nodes, nodeIndex);
      const result = await evaluateExpression(rule.check as string, context);
      if (result !== true) {
        violations.push({
          file: '',
          ruleId: rule.id,
          category: rule.category,
          severity: ruleSeverity(rule),
          description: rule.description,
        });
      }
    }
  }

  const perNodeRules = rules.filter((r) => r.scope !== 'global' && (r.mode !== 'semantic' || judge));

  function applicableRules(node: SpaceNode): Rule[] {
    return perNodeRules.filter((r) => !r.type || r.type === node.resolvedType);
  }

  async function evaluateApplicableRules(node: SpaceNode): Promise<{ blockingRuleId?: string }> {
    let blockingRuleId: string | undefined;
    const applicable = applicableRules(node);

    function report(rule: Rule, evidence?: string, error?: string): void {
      violations.push({
        file: node.label,
        ruleId: rule.id,
        category: rule.category,
        severity: ruleSeverity(rule),
        description: error ? `${rule.description} (Judge error: ${error})` : rule.description,
        ...(evidence !== undefined && { evidence }),
      });
      // A judge error says nothing about the node, so it never gates.
      if (!error && ruleGatesDescendants(rule) && !blockingRuleId) blockingRuleId = rule.id;
    }

    // Cheap deterministic rules first; the judge is only consulted afterwards, once per node.
    for (const rule of applicable.filter((r) => r.mode !== 'semantic')) {
      const result = await evaluateExpression(rule.check as string, buildEvalContext(node, nodes, nodeIndex));
      if (result !== true) report(rule);
    }

    const semantic = applicable.filter((r) => r.mode === 'semantic');
    if (judge && semantic.length > 0) {
      for (const j of await judgeNode(judge, node, semantic)) {
        if (j.record) semanticEvaluations.push(j.record);
        if (j.failed) report(j.rule, j.evidence, j.error);
      }
    }
    return { blockingRuleId };
  }

  function recordGatedSemantic(node: SpaceNode, reason: string): void {
    for (const rule of applicableRules(node)) {
      if (rule.mode === 'semantic') gatedRules.push({ file: node.label, ruleId: rule.id, reason });
    }
  }

  // Non-hierarchy nodes sit outside the subtree cascade — always evaluated, never gated.
  for (const node of graph.nonHierarchy) {
    await evaluateApplicableRules(node);
  }

  const visited = new Set<string>();
  const queue: Array<{ node: SpaceNode; ancestorOrigin?: string }> = [];
  for (const node of [...graph.hierarchyRoots, ...graph.orphans]) {
    queue.push({ node, ancestorOrigin: undefined });
  }

  let qi = 0;
  while (qi < queue.length) {
    const { node, ancestorOrigin } = queue[qi++]!;
    if (visited.has(node.title)) continue;
    visited.add(node.title);

    const selfSeed = seedByTitle.get(node.title);
    const isGatedByAncestor = ancestorOrigin !== undefined;
    const isSelfBlocked = selfSeed !== undefined;
    const isGated = isGatedByAncestor || isSelfBlocked;
    const shouldEvaluate = !isGated || includeGated;

    const { blockingRuleId } = shouldEvaluate ? await evaluateApplicableRules(node) : {};
    if (!shouldEvaluate) {
      recordGatedSemantic(node, isGatedByAncestor ? 'Gated by an ancestor failure' : 'Gated by failure on node');
    }

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
      queue.push({ node: child, ancestorOrigin: childOrigin });
    }
  }

  return {
    violations,
    gates: [...gateOrigins.values()].filter((g) => g.gatedFiles.length > 0),
    semanticEvaluations,
    gatedRules,
  };
}
