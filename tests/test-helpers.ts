import type { BaseNode, HierarchyLevel, Relationship, ResolvedParentRef } from '../src/types';

/**
 * Creates a ResolvedParentRef with sensible defaults for use in tests.
 * Override any field to represent specific edge contexts.
 */
export const makeParentRef = (title: string, overrides: Partial<ResolvedParentRef> = {}): ResolvedParentRef => ({
  title,
  field: 'parent',
  source: 'hierarchy',
  selfRef: false,
  fieldOn: 'child',
  ...overrides,
});

/**
 * Creates a HierarchyLevel with defaults matching schema.loadMetadata normalization.
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
 * Creates a Relationship with defaults matching schema.loadMetadata normalization.
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
  schemaData: { title, type, ...extra },
  linkTargets: linkTargets ?? [title],
  type,
});
