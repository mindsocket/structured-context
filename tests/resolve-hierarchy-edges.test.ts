import { describe, expect, it } from 'bun:test';
import { resolveHierarchyEdges } from '../src/resolve-hierarchy-edges';
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

describe('resolveHierarchyEdges', () => {
  describe("default behavior (fieldOn: 'child', multiple: false)", () => {
    it('resolves parent field on child node to parent title', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const phase = makeNode('Phase 1', 'Phase');
      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Phase 1]]' });

      resolveHierarchyEdges([phase, activity], levels);

      expect(activity.resolvedParents).toEqual(['Phase 1']);
      expect(phase.resolvedParents).toEqual([]);
    });

    it('ignores dangling parent links silently', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Nonexistent Phase]]' });

      resolveHierarchyEdges([activity], levels);

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

      resolveHierarchyEdges([reqA, reqB, tool], levels);

      expect(tool.resolvedParents).toContain('Req A');
      expect(tool.resolvedParents).toContain('Req B');
      expect(tool.resolvedParents).toHaveLength(2);
    });

    it('ignores non-string entries in array field', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const req = makeNode('Req A', 'Requirement');
      const tool = makeNode('Tool X', 'Tool', { fulfills: ['[[Req A]]', 42, null] });

      resolveHierarchyEdges([req, tool], levels);

      expect(tool.resolvedParents).toEqual(['Req A']);
    });

    it('returns empty resolvedParents when field is not an array for multiple=true', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const tool = makeNode('Tool X', 'Tool', { fulfills: '[[Req A]]' }); // string, not array

      resolveHierarchyEdges([tool], levels);

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

      resolveHierarchyEdges([activity, reqA, reqB], levels);

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

      resolveHierarchyEdges([activity1, activity2, sharedReq], levels);

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

      resolveHierarchyEdges([phase, activity, reqA, reqB, tool], levels);

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

      resolveHierarchyEdges([phase, activity], levels);

      // Phase is level 0 (root) — its parent field is not processed
      expect(phase.resolvedParents).toEqual([]);
      expect(activity.resolvedParents).toEqual(['Phase 1']);
    });
  });

  describe('dangling refs are silently ignored', () => {
    it('does not add to resolvedParents when link target not found', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Ghost Phase]]' });

      resolveHierarchyEdges([activity], levels);

      expect(activity.resolvedParents).toEqual([]);
    });
  });

  describe('selfRefField (same-type parent relationships)', () => {
    it('resolves both regular parents and same-type parents when selfRefField is set', () => {
      const levels = [
        makeLevel('Activity'),
        makeLevel('Capability', { field: 'capabilities', fieldOn: 'parent', multiple: true, selfRefField: 'parent' }),
      ];

      const activity = makeNode('Activity 1', 'Activity', {
        capabilities: ['[[Core Capability]]', '[[Sub Capability]]'],
      });
      const coreCapability = makeNode('Core Capability', 'Capability');
      const subCapability = makeNode('Sub Capability', 'Capability', { parent: '[[Core Capability]]' });

      resolveHierarchyEdges([activity, coreCapability, subCapability], levels);

      // Regular relationship: Activity → Capabilities via capabilities field on parent
      expect(coreCapability.resolvedParents).toContain('Activity 1');
      expect(subCapability.resolvedParents).toContain('Activity 1');

      // Same-type relationship: Capability → Capability via parent field on child
      expect(subCapability.resolvedParents).toContain('Core Capability');

      expect(activity.resolvedParents).toEqual([]);
      expect(coreCapability.resolvedParents).toHaveLength(1);
      expect(subCapability.resolvedParents).toHaveLength(2); // Both Activity 1 and Core Capability
    });

    it('supports same-type parents via selfRefField even when primary field is multiple=true', () => {
      const levels = [
        makeLevel('Activity'),
        makeLevel('Tool', { field: 'tools', fieldOn: 'parent', multiple: true, selfRefField: 'partOf' }),
      ];

      const activity = makeNode('Activity 1', 'Activity', {
        tools: ['[[Tool A]]', '[[Tool B]]', '[[Tool C]]'],
      });
      const toolA = makeNode('Tool A', 'Tool');
      const toolB = makeNode('Tool B', 'Tool', { partOf: '[[Tool A]]' });
      const toolC = makeNode('Tool C', 'Tool', { partOf: '[[Tool B]]' });

      resolveHierarchyEdges([activity, toolA, toolB, toolC], levels);

      // Regular relationships: Activity → Tools
      expect(toolA.resolvedParents).toContain('Activity 1');
      expect(toolB.resolvedParents).toContain('Activity 1');
      expect(toolC.resolvedParents).toContain('Activity 1');

      // Same-type relationships: Tools → Tools via partOf field (multiple: false)
      expect(toolB.resolvedParents).toContain('Tool A');
      expect(toolC.resolvedParents).toContain('Tool B');

      expect(toolA.resolvedParents).toHaveLength(1);
      expect(toolB.resolvedParents).toHaveLength(2);
      expect(toolC.resolvedParents).toHaveLength(2);
    });

    it('selfRef without selfRefField uses field for both relationships', () => {
      const levels = [makeLevel('Goal'), makeLevel('Objective', { selfRef: true })];

      const goal = makeNode('Goal 1', 'Goal');
      const objective1 = makeNode('Objective 1', 'Objective', { parent: '[[Goal 1]]' });
      const objective2 = makeNode('Objective 2', 'Objective', { parent: '[[Objective 1]]' });

      resolveHierarchyEdges([goal, objective1, objective2], levels);

      // Regular: Goal → Objective
      expect(objective1.resolvedParents).toContain('Goal 1');

      // Same-type: Objective → Objective (uses same field 'parent')
      expect(objective2.resolvedParents).toContain('Objective 1');

      expect(goal.resolvedParents).toEqual([]);
      expect(objective1.resolvedParents).toHaveLength(1);
      expect(objective2.resolvedParents).toHaveLength(1);
    });

    it('handles missing selfRefField targets gracefully', () => {
      const levels = [
        makeLevel('Activity'),
        makeLevel('Capability', { field: 'capabilities', fieldOn: 'parent', multiple: true, selfRefField: 'parent' }),
      ];

      const activity = makeNode('Activity 1', 'Activity', {
        capabilities: ['[[Capability A]]'],
      });
      const capabilityA = makeNode('Capability A', 'Capability', {
        parent: '[[Nonexistent Parent]]', // selfRefField target that doesn't exist
      });

      resolveHierarchyEdges([activity, capabilityA], levels);

      // Regular relationship resolves
      expect(capabilityA.resolvedParents).toContain('Activity 1');

      // Missing selfRefField target is silently ignored
      expect(capabilityA.resolvedParents).toHaveLength(1);
    });
  });
});
