import { SEMANTIC_SCOPES } from '../schema/metadata-contract';
import { ruleSemantic } from '../schema/rule-severity';
import type { SpaceGraph } from '../space-graph';
import type { Rule, SpaceNode } from '../types';
import type { RelatedNode, SemanticJudgeInput } from './types';

export type SemanticScope = (typeof SEMANTIC_SCOPES)[number];
export type ContentMode = 'none' | 'nodeOnly' | 'fullScope';

/** What a rule asks to send besides the evaluated node's data. */
export interface RuleContext {
  scope: SemanticScope[];
  content: ContentMode;
}

/** The related nodes and bodies a semantic rule asks for. `includeContent: true` means `fullScope`. */
export function ruleContext(rule: Rule): RuleContext {
  const semantic = ruleSemantic(rule);
  const include = semantic?.includeContent;
  return {
    scope: SEMANTIC_SCOPES.filter((s) => semantic?.scope?.includes(s)),
    content: include === undefined ? 'none' : include === true ? 'fullScope' : include,
  };
}

const bodyOf = (node: SpaceNode): string | undefined =>
  node.content ?? (typeof node.schemaData.content === 'string' ? node.schemaData.content : undefined);

/** All schema data except the body, plus the body when asked for. */
function dataWithBody(node: SpaceNode, withBody: boolean): Record<string, unknown> {
  const { content: _content, ...data } = node.schemaData;
  const body = bodyOf(node);
  return withBody && body !== undefined ? { ...data, content: body } : data;
}

/** The evaluated node as a judge sees it. */
export function judgeNodeView(node: SpaceNode, withBody: boolean): SemanticJudgeInput['node'] {
  return {
    label: node.label,
    title: node.title,
    type: node.type,
    resolvedType: node.resolvedType,
    schemaData: dataWithBody(node, withBody),
    resolvedParents: node.resolvedParents,
  };
}

function relatedView(node: SpaceNode, relation: string, withBody: boolean): RelatedNode {
  const { title: _title, type: _type, ...data } = dataWithBody(node, withBody);
  return { relations: [relation], title: node.title, type: node.resolvedType, data };
}

const RELATION_ORDER = ['parent', 'sibling', 'child', 'ancestor', 'descendant'];

/**
 * The nodes a scope adds for a node, along main-hierarchy edges only. Selection reads the graph's structure and
 * nothing else: not verdicts, not gating. Each node appears once, with every relation it has.
 */
export function relatedNodes(graph: SpaceGraph, node: SpaceNode, context: RuleContext): RelatedNode[] {
  const withBody = context.content === 'fullScope';
  const hierarchyName = graph.hierarchy?.name;
  const parentsOf = (n: SpaceNode): SpaceNode[] =>
    graph.hierarchy === undefined
      ? []
      : n.resolvedParents
          .filter((p) => p.source === 'hierarchy' && p.hierarchy === hierarchyName)
          .map((p) => graph.nodes.get(p.title))
          .filter((p): p is SpaceNode => p !== undefined);
  const childrenOf = (n: SpaceNode) => graph.hierarchyChildren.get(n.title) ?? [];

  const found = new Map<string, RelatedNode>();
  const add = (other: SpaceNode, relation: string) => {
    if (other.title === node.title) return;
    const existing = found.get(other.title);
    if (!existing) found.set(other.title, relatedView(other, relation, withBody));
    else if (!existing.relations.includes(relation)) existing.relations.push(relation);
  };
  /** Every node reachable by repeatedly following `next`, each visited once. */
  const reach = (next: (n: SpaceNode) => readonly SpaceNode[], relation: string) => {
    const seen = new Set<string>([node.title]);
    let level = next(node);
    while (level.length > 0) {
      const following: SpaceNode[] = [];
      for (const n of level) {
        if (seen.has(n.title)) continue;
        seen.add(n.title);
        add(n, relation);
        following.push(...next(n));
      }
      level = following;
    }
  };

  const scope = new Set(context.scope);
  if (scope.has('parent')) for (const p of parentsOf(node)) add(p, 'parent');
  if (scope.has('siblings')) for (const p of parentsOf(node)) for (const s of childrenOf(p)) add(s, 'sibling');
  if (scope.has('children')) for (const c of childrenOf(node)) add(c, 'child');
  if (scope.has('ancestors')) reach(parentsOf, 'ancestor');
  if (scope.has('descendants')) reach(childrenOf, 'descendant');

  const rank = (r: RelatedNode) => Math.min(...r.relations.map((x) => RELATION_ORDER.indexOf(x)));
  return [...found.values()].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** Stable key for rules that share a context, so they can share a provider input. */
export const contextKey = (context: RuleContext) => `${context.content}|${context.scope.join(',')}`;

/** The judge input context for rules that share `context`: the node view and its related nodes. */
export function judgeContext(
  graph: SpaceGraph,
  node: SpaceNode,
  context: RuleContext,
): Pick<SemanticJudgeInput, 'node' | 'related'> {
  const related = relatedNodes(graph, node, context);
  return {
    node: judgeNodeView(node, context.content !== 'none'),
    ...(related.length > 0 && { related }),
  };
}
