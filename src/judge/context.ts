import type { AnySchemaObject } from 'ajv';
import { SEMANTIC_SCOPES } from '../schema/metadata-contract';
import { ruleSemantic } from '../schema/rule-severity';
import { mergeVariantProperties } from '../schema/schema-refs';
import type { SpaceGraph } from '../space-graph';
import type { NodeId, Rule, SpaceContext, SpaceNode } from '../types';
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

/**
 * A node's fields as a judge sees them: without the body unless asked for, and without `title` and `type`, which
 * travel separately (the type as the canonical one, so a judge never sees an alias).
 */
function judgeFields(node: SpaceNode, withBody: boolean): Record<string, unknown> {
  const { title: _title, type: _type, content, ...fields } = node.schemaData;
  return withBody && content !== undefined ? { ...fields, content } : fields;
}

/** The evaluated node as a judge sees it. */
function judgeNodeView(node: SpaceNode, withBody: boolean, graph: SpaceGraph): SemanticJudgeInput['node'] {
  return {
    id: node.id,
    title: node.title,
    resolvedType: node.resolvedType,
    schemaData: judgeFields(node, withBody),
    parentTitles: node.resolvedParents.map((p) => graph.nodes.get(p.id)?.title ?? p.id),
  };
}

type Relation = RelatedNode['relations'][number];

function relatedView(node: SpaceNode, relation: Relation, withBody: boolean): RelatedNode {
  return {
    relations: [relation],
    title: node.title,
    type: node.resolvedType,
    data: judgeFields(node, withBody),
  };
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

type SchemaDescriptions = NonNullable<SemanticJudgeInput['schemaDescriptions']>;

/** Fields every node has, which the prompt already explains. */
const SELF_EXPLAINED_FIELDS = new Set(['type', 'title', 'content']);

function describeField(def: AnySchemaObject): string | undefined {
  const values = Array.isArray(def.enum) ? `one of: ${def.enum.join(', ')}` : undefined;
  const description = typeof def.description === 'string' ? def.description : undefined;
  return description && values ? `${description} (${values})` : (description ?? values);
}

/**
 * The schema's descriptions of each node type: the `oneOf` entry's `description` and each field's `description`
 * and enum values. A type or field the schema does not describe is left out.
 */
export function describeSchema({
  schema,
  schemaRefRegistry,
}: Pick<SpaceContext, 'schema' | 'schemaRefRegistry'>): SchemaDescriptions {
  const out: SchemaDescriptions = {};
  for (const entry of Array.isArray(schema.oneOf) ? (schema.oneOf as AnySchemaObject[]) : []) {
    const { properties } = mergeVariantProperties(entry, schema, schemaRefRegistry);
    const fields: Record<string, string> = {};
    for (const [name, def] of Object.entries(properties)) {
      const text = SELF_EXPLAINED_FIELDS.has(name) ? undefined : describeField(def);
      if (text) fields[name] = text;
    }
    const description = typeof entry.description === 'string' ? entry.description : undefined;
    if (!description && Object.keys(fields).length === 0) continue;
    const typeDef = properties.type;
    const names = typeDef?.const !== undefined ? [typeDef.const] : Array.isArray(typeDef?.enum) ? typeDef.enum : [];
    for (const name of names) {
      out[String(name)] = { ...(description && { description }), ...(Object.keys(fields).length > 0 && { fields }) };
    }
  }
  return out;
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

/** The schema's descriptions of the types in an input: the evaluated node's and its related nodes'. */
export function schemaDescriptionsFor(
  descriptions: SchemaDescriptions,
  { node, related = [] }: Pick<SemanticJudgeInput, 'node' | 'related'>,
): Pick<SemanticJudgeInput, 'schemaDescriptions'> {
  const picked: SchemaDescriptions = {};
  for (const type of [node.resolvedType, ...related.map((r) => r.type)]) {
    if (descriptions[type]) picked[type] = descriptions[type];
  }
  return Object.keys(picked).length > 0 ? { schemaDescriptions: picked } : {};
}
