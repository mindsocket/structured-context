import type { HierarchyLevel } from '../src/types';

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
