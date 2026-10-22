import type { NodeId, SpaceNode } from '../types';
import type { AugmentedFlatNode, EdgeMetadata } from './augment-nodes';

// ---------------------------------------------------------------------------
// Directive types
// ---------------------------------------------------------------------------

export type AncestorsDirective = {
  kind: 'ancestors';
  /** Filter by resolved type of the ancestor node. Absent means include all. */
  typeFilter?: string;
};

export type DescendantsDirective = {
  kind: 'descendants';
  /** Filter by resolved type of the descendant node. Absent means include all. */
  typeFilter?: string;
};

export type SiblingsDirective = {
  kind: 'siblings';
};

/**
 * Relationship directive covers all non-hierarchy edges.
 * Progressive specification mirrors the `parent_type:field:child_type` naming convention.
 * Any combination of filters may be present; absent fields are treated as wildcards.
 */
export type RelationshipsDirective = {
  kind: 'relationships';
  /** Filter by the child side's resolved type. */
  childType?: string;
  /** Filter by the parent side's resolved type. */
  parentType?: string;
  /** Filter by the edge field name. */
  field?: string;
};

export type IncludeDirective = AncestorsDirective | DescendantsDirective | SiblingsDirective | RelationshipsDirective;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a SELECT include spec string into a list of directives.
 *
 * Grammar:
 *   spec       = directive (',' directive)*
 *   directive  = 'ancestors' ('(' type ')')?
 *              | 'descendants' ('(' type ')')?
 *              | 'siblings'
 *              | 'relationships' ('(' relSpec ')')?
 *   type       = identifier
 *   relSpec    = childType
 *              | parentType ':' childType
 *              | parentType ':' field ':' childType
 *
 * Keywords are case-insensitive. Identifiers match \w+.
 * Range syntax (type..type) is reserved for a future release.
 */
export function parseIncludeSpec(spec: string): IncludeDirective[] {
  const items = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error('SELECT spec must not be empty');
  return items.map(parseDirective);
}

function parseDirective(item: string): IncludeDirective {
  const match = item.match(/^(\w+)(?:\(([^)]*)\))?$/i);
  if (!match) throw new Error(`Invalid include directive: "${item}"`);

  const name = match[1]!.toLowerCase();
  const arg = match[2]?.trim();

  if (name === 'siblings') {
    if (arg !== undefined && arg !== '') throw new Error('siblings() does not accept arguments');
    return { kind: 'siblings' };
  }

  if (name === 'ancestors' || name === 'descendants') {
    if (!arg) return { kind: name };
    if (arg.includes('..')) {
      throw new Error(`Range syntax "${arg}" in SELECT is not yet supported. Use a plain type name for now.`);
    }
    if (!/^\w+$/.test(arg)) throw new Error(`Invalid type name in ${name}(): "${arg}"`);
    return { kind: name, typeFilter: arg };
  }

  if (name === 'relationships') {
    if (!arg) return { kind: 'relationships' };
    const parts = arg.split(':').map((s) => s.trim());
    if (parts.some((p) => !/^\w+$/.test(p))) {
      throw new Error(`Invalid relationship spec: "${arg}"`);
    }
    if (parts.length === 1) return { kind: 'relationships', childType: parts[0] };
    if (parts.length === 2) return { kind: 'relationships', parentType: parts[0], childType: parts[1] };
    if (parts.length === 3) {
      return { kind: 'relationships', parentType: parts[0], field: parts[1], childType: parts[2] };
    }
    throw new Error(`Relationship spec "${arg}" has too many parts (max 3: parent:field:child)`);
  }

  throw new Error(`Unknown include directive "${item}". Expected: ancestors, descendants, siblings, relationships`);
}

// ---------------------------------------------------------------------------
// Expander
// ---------------------------------------------------------------------------

/**
 * Expand the matched node set by adding nodes specified by the include directives.
 *
 * Processes each matched node and each directive, collecting additional nodes to
 * include. The result is `matched ∪ expanded`, preserving original order with new
 * nodes appended in the order they are discovered.
 *
 * @param matchedNodes - Nodes already matched by the WHERE clause (or all nodes for SELECT-only)
 * @param directives - Parsed include directives from the SELECT clause
 * @param nodeIndex - Title → SpaceNode lookup
 * @param childrenIndex - Title → direct children (all edges)
 * @param augmented - Title → AugmentedFlatNode with pre-computed ancestors/descendants
 */
export function expandInclude(
  matchedNodes: SpaceNode[],
  directives: IncludeDirective[],
  nodeIndex: ReadonlyMap<NodeId, SpaceNode>,
  childrenIndex: ReadonlyMap<NodeId, readonly SpaceNode[]>,
  augmented: Map<NodeId, AugmentedFlatNode>,
): SpaceNode[] {
  if (directives.length === 0) return matchedNodes;

  const seen = new Set<NodeId>(matchedNodes.map((n) => n.id));
  const result: SpaceNode[] = [...matchedNodes];

  function addById(id: NodeId) {
    if (seen.has(id)) return;
    const node = nodeIndex.get(id);
    if (node) {
      seen.add(id);
      result.push(node);
    }
  }

  for (const node of matchedNodes) {
    const aug = augmented.get(node.id);
    if (!aug) continue;

    for (const directive of directives) {
      applyDirective(node, aug, directive, childrenIndex, addById);
    }
  }

  return result;
}

function applyDirective(
  node: SpaceNode,
  aug: AugmentedFlatNode,
  directive: IncludeDirective,
  childrenIndex: ReadonlyMap<NodeId, readonly SpaceNode[]>,
  addById: (id: NodeId) => void,
): void {
  switch (directive.kind) {
    case 'ancestors': {
      for (const a of aug.ancestors) {
        if (!directive.typeFilter || a.resolvedType === directive.typeFilter) {
          addById(a.id as NodeId);
        }
      }
      break;
    }
    case 'descendants': {
      for (const d of aug.descendants) {
        if (!directive.typeFilter || d.resolvedType === directive.typeFilter) {
          addById(d.id as NodeId);
        }
      }
      break;
    }
    case 'siblings': {
      // Nodes that share at least one parent with the matched node (any edge type)
      for (const parentRef of node.resolvedParents) {
        const siblings = childrenIndex.get(parentRef.id) ?? [];
        for (const sibling of siblings) {
          if (sibling.id !== node.id) {
            addById(sibling.id);
          }
        }
      }
      break;
    }
    case 'relationships': {
      // Relationship-sourced ancestors (matched node is the child side)
      for (const a of aug.ancestors) {
        if (a._source === 'relationship' && matchesRelSpec(node, a, directive, true)) {
          addById(a.id as NodeId);
        }
      }
      // Relationship-sourced descendants (matched node is the parent side)
      for (const d of aug.descendants) {
        if (d._source === 'relationship' && matchesRelSpec(node, d, directive, false)) {
          addById(d.id as NodeId);
        }
      }
      break;
    }
  }
}

/**
 * Check whether a relationship edge entry matches the directive's filter spec.
 *
 * @param matchedNode - The node from the matched set
 * @param entry - An ancestor or descendant entry with edge metadata
 * @param directive - The relationships directive with optional type/field filters
 * @param entryIsParent - true if entry is the parent side (ancestor), false if child side (descendant)
 */
function matchesRelSpec(
  matchedNode: SpaceNode,
  entry: Record<string, unknown> & EdgeMetadata,
  directive: RelationshipsDirective,
  entryIsParent: boolean,
): boolean {
  if (!directive.childType && !directive.parentType && !directive.field) return true;

  const entryType = entry.resolvedType as string;
  const matchedType = matchedNode.resolvedType;
  // When entry is the parent, matched node is the child, and vice versa
  const parentType = entryIsParent ? entryType : matchedType;
  const childType = entryIsParent ? matchedType : entryType;

  if (directive.parentType && parentType !== directive.parentType) return false;
  if (directive.childType && childType !== directive.childType) return false;
  if (directive.field && entry._field !== directive.field) return false;
  return true;
}
