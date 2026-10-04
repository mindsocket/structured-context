import type { BaseNode, Hierarchy, HierarchyLevel, Relationship, ResolvedParentRef, SpaceNode } from './types';

/**
 * Creates a ResolvedParentRef with sensible defaults for use in tests.
 * Override any field to represent specific edge contexts.
 */
export const makeParentRef = (title: string, overrides: Partial<ResolvedParentRef> = {}): ResolvedParentRef => {
  const source = overrides.source ?? 'hierarchy';
  return {
    title,
    field: 'parent',
    source,
    ...(source === 'hierarchy' ? { hierarchy: 'main' } : {}),
    selfRef: false,
    fieldOn: 'child',
    ...overrides,
  };
};

/**
 * Creates a HierarchyLevel with defaults matching schema metadata normalization.
 */
export const makeLevel = (type: string, overrides: Partial<HierarchyLevel> = {}): HierarchyLevel => ({
  type,
  field: 'parent',
  fieldOn: 'child',
  multiple: false,
  selfRef: false,
  ...overrides,
});

/**
 * Creates a named Hierarchy (default name 'main') from normalized levels.
 */
export const makeHierarchy = (levels: HierarchyLevel[], overrides: Partial<Hierarchy> = {}): Hierarchy => ({
  name: 'main',
  levels,
  ...overrides,
});

/**
 * SchemaMetadata fields for a schema whose only hierarchy is its main hierarchy.
 */
export const withHierarchy = (
  levels: HierarchyLevel[],
  overrides: Partial<Hierarchy> = {},
): { hierarchy: Hierarchy; hierarchies: Hierarchy[] } => {
  const hierarchy = makeHierarchy(levels, overrides);
  return { hierarchy, hierarchies: [hierarchy] };
};

/**
 * Creates a Relationship with defaults matching schema metadata normalization.
 */
export const makeRelationship = (
  parent: string,
  type: string,
  overrides: Partial<Relationship> = {},
): Relationship => ({
  parent,
  type,
  field: 'parent',
  fieldOn: 'child',
  multiple: false,
  ...overrides,
});

/**
 * Creates a BaseNode with sensible defaults for use in tests.
 */
export const makeNode = (
  title: string,
  type: string,
  extra: Record<string, unknown> = {},
  linkTargets?: string[],
): BaseNode => ({
  label: `${title}.md`,
  title,
  schemaData: { title, type, ...extra },
  linkTargets: linkTargets ?? [title],
  type,
});

/**
 * Creates a SpaceNode with sensible defaults for use in tests.
 */
export const makeSpaceNode = (
  title: string,
  type: string,
  extra: Record<string, unknown> = {},
  linkTargets?: string[],
  resolvedParents: ResolvedParentRef[] = [],
  resolvedLinks: SpaceNode['resolvedLinks'] = [],
): SpaceNode => ({
  ...makeNode(title, type, extra, linkTargets),
  resolvedType: type,
  resolvedParents,
  resolvedLinks,
});
