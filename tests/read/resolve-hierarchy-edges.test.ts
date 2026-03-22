import { describe, expect, it } from 'bun:test';
import { resolveGraphEdges } from '../../src/read/resolve-graph-edges';
import type { Relationship } from '../../src/types';
import { makeLevel, makeNode } from '../test-helpers';

describe('resolveGraphEdges', () => {
  describe("default behavior (fieldOn: 'child', multiple: false)", () => {
    it('resolves parent field on child node to parent title', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const phase = makeNode('Phase 1', 'Phase');
      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Phase 1]]' });

      resolveGraphEdges([phase, activity], { hierarchy: { levels } });

      expect(activity.resolvedParents.map((r) => r.title)).toEqual(['Phase 1']);
      expect(phase.resolvedParents).toEqual([]);
    });

    it('returns unresolved ref for dangling parent links', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Nonexistent Phase]]' });

      const unresolvedRefs = resolveGraphEdges([activity], { hierarchy: { levels } });

      expect(activity.resolvedParents).toEqual([]);
      expect(unresolvedRefs).toHaveLength(1);
      expect(unresolvedRefs[0]).toMatchObject({
        label: 'Activity 1.md',
        ref: '[[Nonexistent Phase]]',
        field: 'parent',
        reason: 'not_found',
      });
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

      resolveGraphEdges([reqA, reqB, tool], { hierarchy: { levels } });

      expect(tool.resolvedParents.map((r) => r.title)).toContain('Req A');
      expect(tool.resolvedParents.map((r) => r.title)).toContain('Req B');
      expect(tool.resolvedParents).toHaveLength(2);
    });

    it('ignores non-string entries in array field', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const req = makeNode('Req A', 'Requirement');
      const tool = makeNode('Tool X', 'Tool', { fulfills: ['[[Req A]]', 42, null] });

      resolveGraphEdges([req, tool], { hierarchy: { levels } });

      expect(tool.resolvedParents.map((r) => r.title)).toEqual(['Req A']);
    });

    it('returns invalid_shape unresolved ref when array field gets a string', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const tool = makeNode('Tool X', 'Tool', { fulfills: '[[Req A]]' }); // string, not array

      const unresolvedRefs = resolveGraphEdges([tool], { hierarchy: { levels } });

      expect(tool.resolvedParents).toEqual([]);
      expect(unresolvedRefs).toHaveLength(1);
      expect(unresolvedRefs[0]).toMatchObject({
        label: 'Tool X.md',
        ref: '[[Req A]]',
        field: 'fulfills',
        reason: 'invalid_shape',
      });
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

      resolveGraphEdges([activity, reqA, reqB], { hierarchy: { levels } });

      expect(reqA.resolvedParents.map((r) => r.title)).toEqual(['Activity 1']);
      expect(reqB.resolvedParents.map((r) => r.title)).toEqual(['Activity 1']);
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

      resolveGraphEdges([activity1, activity2, sharedReq], { hierarchy: { levels } });

      expect(sharedReq.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(sharedReq.resolvedParents.map((r) => r.title)).toContain('Activity 2');
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

      resolveGraphEdges([phase, activity, reqA, reqB, tool], { hierarchy: { levels } });

      expect(activity.resolvedParents.map((r) => r.title)).toEqual(['Phase 1']);
      expect(reqA.resolvedParents.map((r) => r.title)).toEqual(['Activity 1']);
      expect(reqB.resolvedParents.map((r) => r.title)).toEqual(['Activity 1']);
      expect(tool.resolvedParents.map((r) => r.title)).toEqual(['Req A']);
      expect(phase.resolvedParents).toEqual([]);
    });
  });

  describe('root level is ignored', () => {
    it('does not process level 0 for edge resolution', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const phase = makeNode('Phase 1', 'Phase', { parent: '[[Activity 1]]' });
      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Phase 1]]' });

      resolveGraphEdges([phase, activity], { hierarchy: { levels } });

      // Phase is level 0 (root) — its parent field is not processed
      expect(phase.resolvedParents).toEqual([]);
      expect(activity.resolvedParents.map((r) => r.title)).toEqual(['Phase 1']);
    });
  });

  describe('dangling refs return unresolved entries', () => {
    it('does not add to resolvedParents and returns unresolved ref when link target not found', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Ghost Phase]]' });

      const unresolvedRefs = resolveGraphEdges([activity], { hierarchy: { levels } });

      expect(activity.resolvedParents).toEqual([]);
      expect(unresolvedRefs).toHaveLength(1);
      expect(unresolvedRefs[0]).toMatchObject({
        label: 'Activity 1.md',
        ref: '[[Ghost Phase]]',
        field: 'parent',
        reason: 'not_found',
      });
    });
  });

  describe('relationship edges', () => {
    it('assigns source: hierarchy when type appears in both hierarchy and a relationship', () => {
      const levels = [makeLevel('project'), makeLevel('task')];
      const relationships: Relationship[] = [
        {
          parent: 'project',
          type: 'task',
          field: 'project',
          fieldOn: 'child',
          multiple: false,
          matchers: ['Tasks'],
        },
      ];

      const project = makeNode('Project A', 'project');
      const task = makeNode('Task 1', 'task', { parent: '[[Project A]]' });

      resolveGraphEdges([project, task], { hierarchy: { levels }, relationships });

      const ref = task.resolvedParents.find((r) => r.title === 'Project A');
      expect(ref).toBeDefined();
      expect(ref?.source).toBe('hierarchy');
    });

    it('assigns source: relationship when type appears only in relationships', () => {
      const levels = [makeLevel('project')];
      const relationships: Relationship[] = [
        {
          parent: 'project',
          type: 'resource',
          field: 'parent',
          fieldOn: 'child',
          multiple: false,
          matchers: ['Resources'],
        },
      ];

      const project = makeNode('Project A', 'project');
      const resource = makeNode('Resource 1', 'resource', { parent: '[[Project A]]' });

      resolveGraphEdges([project, resource], { hierarchy: { levels }, relationships });

      const ref = resource.resolvedParents.find((r) => r.title === 'Project A');
      expect(ref).toBeDefined();
      expect(ref?.source).toBe('relationship');
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

      resolveGraphEdges([activity, coreCapability, subCapability], { hierarchy: { levels } });

      // Regular relationship: Activity → Capabilities via capabilities field on parent
      expect(coreCapability.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(subCapability.resolvedParents.map((r) => r.title)).toContain('Activity 1');

      // Same-type relationship: Capability → Capability via parent field on child
      expect(subCapability.resolvedParents.map((r) => r.title)).toContain('Core Capability');

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

      resolveGraphEdges([activity, toolA, toolB, toolC], { hierarchy: { levels } });

      // Regular relationships: Activity → Tools
      expect(toolA.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(toolB.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(toolC.resolvedParents.map((r) => r.title)).toContain('Activity 1');

      // Same-type relationships: Tools → Tools via partOf field (multiple: false)
      expect(toolB.resolvedParents.map((r) => r.title)).toContain('Tool A');
      expect(toolC.resolvedParents.map((r) => r.title)).toContain('Tool B');

      expect(toolA.resolvedParents).toHaveLength(1);
      expect(toolB.resolvedParents).toHaveLength(2);
      expect(toolC.resolvedParents).toHaveLength(2);
    });

    it('selfRef without selfRefField uses field for both relationships', () => {
      const levels = [makeLevel('Goal'), makeLevel('Objective', { selfRef: true })];

      const goal = makeNode('Goal 1', 'Goal');
      const objective1 = makeNode('Objective 1', 'Objective', { parent: '[[Goal 1]]' });
      const objective2 = makeNode('Objective 2', 'Objective', { parent: '[[Objective 1]]' });

      resolveGraphEdges([goal, objective1, objective2], { hierarchy: { levels } });

      // Regular: Goal → Objective
      expect(objective1.resolvedParents.map((r) => r.title)).toContain('Goal 1');

      // Same-type: Objective → Objective (uses same field 'parent')
      expect(objective2.resolvedParents.map((r) => r.title)).toContain('Objective 1');

      expect(goal.resolvedParents).toEqual([]);
      expect(objective1.resolvedParents).toHaveLength(1);
      expect(objective2.resolvedParents).toHaveLength(1);
    });

    it('returns unresolved ref for missing selfRefField targets', () => {
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

      const unresolvedRefs = resolveGraphEdges([activity, capabilityA], { hierarchy: { levels } });

      // Regular relationship resolves
      expect(capabilityA.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(capabilityA.resolvedParents).toHaveLength(1);

      // Missing selfRefField target returns an unresolved ref
      expect(unresolvedRefs).toHaveLength(1);
      expect(unresolvedRefs[0]).toMatchObject({
        label: 'Capability A.md',
        ref: '[[Nonexistent Parent]]',
        field: 'parent',
        reason: 'not_found',
      });
    });
  });
});
