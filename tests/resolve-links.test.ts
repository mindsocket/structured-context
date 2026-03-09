import { describe, expect, it } from 'bun:test';
import { resolveLinks } from '../src/resolve-links';
import type { SpaceNode } from '../src/types';
import { makeLevel } from './test-helpers';

// Helper to build a test node
function makeNode(title: string, type: string, extra: Record<string, unknown> = {}, linkTargets?: string[]): SpaceNode {
  return {
    label: `${title}.md`,
    schemaData: { title, type, ...extra },
    linkTargets: linkTargets ?? [title],
    resolvedParents: [],
    resolvedType: type,
  };
}

describe('resolveLinks', () => {
  describe("default behavior (fieldOn: 'child', multiple: false)", () => {
    it('resolves parent field on child node to parent title', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const phase = makeNode('Phase 1', 'Phase');
      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Phase 1]]' });

      resolveLinks([phase, activity], levels);

      expect(activity.resolvedParents).toEqual(['Phase 1']);
      expect(phase.resolvedParents).toEqual([]);
    });

    it('ignores dangling parent links silently', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Nonexistent Phase]]' });

      resolveLinks([activity], levels);

      expect(activity.resolvedParents).toEqual([]);
    });
  });

  describe("multiple parents (fieldOn: 'child', multiple: true)", () => {
    it('resolves array field to multiple parent titles', () => {
      const levels = [
        makeLevel('Activity'),
        makeLevel('Requirement'),
        makeLevel('Tool', { field: 'fulfills', multiple: true }),
      ];

      const reqA = makeNode('Req A', 'Requirement');
      const reqB = makeNode('Req B', 'Requirement');
      const tool = makeNode('Tool X', 'Tool', { fulfills: ['[[Req A]]', '[[Req B]]'] });

      resolveLinks([reqA, reqB, tool], levels);

      expect(tool.resolvedParents).toContain('Req A');
      expect(tool.resolvedParents).toContain('Req B');
      expect(tool.resolvedParents).toHaveLength(2);
    });

    it('ignores non-string entries in array field', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const req = makeNode('Req A', 'Requirement');
      const tool = makeNode('Tool X', 'Tool', { fulfills: ['[[Req A]]', 42, null] });

      resolveLinks([req, tool], levels);

      expect(tool.resolvedParents).toEqual(['Req A']);
    });

    it('returns empty resolvedParents when field is not an array for multiple=true', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const tool = makeNode('Tool X', 'Tool', { fulfills: '[[Req A]]' }); // string, not array

      resolveLinks([tool], levels);

      expect(tool.resolvedParents).toEqual([]);
    });
  });

  describe("parent sets children (fieldOn: 'parent', multiple: true)", () => {
    it('assigns parent title to children referenced in parent field', () => {
      const levels = [
        makeLevel('Activity'),
        makeLevel('Requirement', { field: 'generates_requirements', fieldOn: 'parent', multiple: true }),
      ];

      const activity = makeNode('Activity 1', 'Activity', {
        generates_requirements: ['[[Req A]]', '[[Req B]]'],
      });
      const reqA = makeNode('Req A', 'Requirement');
      const reqB = makeNode('Req B', 'Requirement');

      resolveLinks([activity, reqA, reqB], levels);

      expect(reqA.resolvedParents).toEqual(['Activity 1']);
      expect(reqB.resolvedParents).toEqual(['Activity 1']);
      expect(activity.resolvedParents).toEqual([]);
    });

    it('handles multiple activities pointing to the same requirement', () => {
      const levels = [
        makeLevel('Activity'),
        makeLevel('Requirement', { field: 'generates_requirements', fieldOn: 'parent', multiple: true }),
      ];

      const activity1 = makeNode('Activity 1', 'Activity', {
        generates_requirements: ['[[Shared Req]]'],
      });
      const activity2 = makeNode('Activity 2', 'Activity', {
        generates_requirements: ['[[Shared Req]]'],
      });
      const sharedReq = makeNode('Shared Req', 'Requirement');

      resolveLinks([activity1, activity2, sharedReq], levels);

      expect(sharedReq.resolvedParents).toContain('Activity 1');
      expect(sharedReq.resolvedParents).toContain('Activity 2');
      expect(sharedReq.resolvedParents).toHaveLength(2);
    });
  });

  describe('mixed hierarchy', () => {
    it('resolves a 4-level hierarchy with all three edge patterns', () => {
      const levels = [
        makeLevel('Phase'),
        makeLevel('Activity', { field: 'phase' }),
        makeLevel('Requirement', { field: 'generates_requirements', fieldOn: 'parent', multiple: true }),
        makeLevel('Tool', { field: 'fulfills', multiple: true }),
      ];

      const phase = makeNode('Phase 1', 'Phase');
      const activity = makeNode('Activity 1', 'Activity', {
        phase: '[[Phase 1]]',
        generates_requirements: ['[[Req A]]', '[[Req B]]'],
      });
      const reqA = makeNode('Req A', 'Requirement');
      const reqB = makeNode('Req B', 'Requirement');
      const tool = makeNode('Tool X', 'Tool', { fulfills: ['[[Req A]]'] });

      resolveLinks([phase, activity, reqA, reqB, tool], levels);

      expect(activity.resolvedParents).toEqual(['Phase 1']);
      expect(reqA.resolvedParents).toEqual(['Activity 1']);
      expect(reqB.resolvedParents).toEqual(['Activity 1']);
      expect(tool.resolvedParents).toEqual(['Req A']);
      expect(phase.resolvedParents).toEqual([]);
    });
  });

  describe('root level is ignored', () => {
    it('does not process level 0 for edge resolution', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const phase = makeNode('Phase 1', 'Phase', { parent: '[[Activity 1]]' });
      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Phase 1]]' });

      resolveLinks([phase, activity], levels);

      // Phase is level 0 (root) — its parent field is not processed
      expect(phase.resolvedParents).toEqual([]);
      expect(activity.resolvedParents).toEqual(['Phase 1']);
    });
  });

  describe('dangling refs are silently ignored', () => {
    it('does not add to resolvedParents when link target not found', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Ghost Phase]]' });

      resolveLinks([activity], levels);

      expect(activity.resolvedParents).toEqual([]);
    });
  });
});
