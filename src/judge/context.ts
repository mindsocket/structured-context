import { SEMANTIC_SCOPES } from '../schema/metadata-contract';
import { ruleSemantic } from '../schema/rule-severity';
import type { SpaceGraph } from '../space-graph';
import type { NodeId, Rule, SpaceNode } from '../types';
import type { RelatedNode, SemanticJudgeInput } from './types';

export type SemanticScope = Exclude<(typeof SEMANTIC_SCOPES)[number], 'branch'>;
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
  const asked = new Set<string>(semantic?.scope ?? []);
  if (asked.has('branch')) asked.add('ancestors').add('descendants');
  // A wider scope implies the narrower one, so equal node sets give equal inputs and direct relations keep their label.
  if (asked.has('ancestors')) asked.add('parent');
  if (asked.has('descendants')) asked.add('children');
  return {
    scope: SEMANTIC_SCOPES.filter((s): s is SemanticScope => s !== 'branch' && asked.has(s)),
    content: include === undefined ? 'none' : include === true ? 'fullScope' : include,
  };
}

/** All schema data, without the body unless asked for. */
function dataWithBody(node: SpaceNode, withBody: boolean): Record<string, unknown> {
  if (withBody) return node.schemaData;
  const { content: _content, ...data } = node.schemaData;
  return data;
}

/** The evaluated node as a judge sees it. */
function judgeNodeView(node: SpaceNode, withBody: boolean, graph: SpaceGraph): SemanticJudgeInput['node'] {
  return {
    id: node.id,
    title: node.title,
    type: node.type,
    resolvedType: node.resolvedType,
    schemaData: dataWithBody(node, withBody),
    parentTitles: node.resolvedParents.map((p) => graph.nodes.get(p.id)?.title ?? p.id),
  };
}

type Relation = RelatedNode['relations'][number];

function relatedView(node: SpaceNode, relation: Relation, withBody: boolean): RelatedNode {
  const { title: _title, type: _type, ...data } = dataWithBody(node, withBody);
  return { relations: [relation], title: node.title, type: node.resolvedType, data };
}

/**
 * The nodes a scope adds for a node, along main-hierarchy edges only. Selection reads the graph's structure and
 * nothing else: not verdicts, not gating. Each node appears once, with every relation it has, nearest first.
 */
export function relatedNodes(graph: SpaceGraph, node: SpaceNode, context: RuleContext): RelatedNode[] {
  const withBody = context.content === 'fullScope';
  const hierarchyName = graph.hierarchy?.name;
  const parentsOf = (n: SpaceNode): SpaceNode[] =>
    graph.hierarchy === undefined
      ? []
      : n.resolvedParents
          .filter((p) => p.kind === 'hierarchy' && p.hierarchy === hierarchyName)
          .map((p) => graph.nodes.get(p.id))
          .filter((p): p is SpaceNode => p !== undefined);
  const childrenOf = (n: SpaceNode) => graph.hierarchyChildren.get(n.id) ?? [];

  const found = new Map<NodeId, RelatedNode>();
  const add = (other: SpaceNode, relation: Relation) => {
    if (other.id === node.id) return;
    const existing = found.get(other.id);
    if (!existing) found.set(other.id, relatedView(other, relation, withBody));
    else if (!existing.relations.includes(relation)) existing.relations.push(relation);
  };
  const reach = (next: (n: SpaceNode) => readonly SpaceNode[], relation: Relation) => {
    const seen = new Set<NodeId>([node.id]);
    let level = next(node);
    while (level.length > 0) {
      const following: SpaceNode[] = [];
      for (const n of level) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
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
  return [...found.values()];
}

/** The judge input context for rules that share `context`: the node view and its related nodes. */
export function judgeContext(
  graph: SpaceGraph,
  node: SpaceNode,
  context: RuleContext,
): Pick<SemanticJudgeInput, 'node' | 'related'> {
  const related = relatedNodes(graph, node, context);
  return {
    node: judgeNodeView(node, context.content !== 'none', graph),
    ...(related.length > 0 && { related }),
  };
}
