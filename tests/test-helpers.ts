import type { HierarchyLevel, ResolvedParentRef } from '../src/types';

/**
 * Creates a ResolvedParentRef with sensible defaults for use in tests.
 * Override any field to represent specific edge contexts.
 */
export const makeParentRef = (title: string, overrides: Partial<ResolvedParentRef> = {}): ResolvedParentRef => ({
  title,
  field: 'parent',
  source: 'hierarchy',
  selfRef: false,
  ...overrides,
});

/**
 * Creates a HierarchyLevel with defaults matching schema.loadMetadata
 *
 */
export const makeLevel = (type: string, overrides: Partial<HierarchyLevel> = {}): HierarchyLevel => ({
  type,
  field: 'parent',
  fieldOn: 'child',
  multiple: false,
  selfRef: false,
  ...overrides,
});
