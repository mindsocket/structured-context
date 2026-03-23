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

      const { nodes } = resolveGraphEdges([phase, activity], { hierarchy: { levels } });

      const resolvedActivity = nodes.find((n) => n.label === 'Activity 1.md')!;
      const resolvedPhase = nodes.find((n) => n.label === 'Phase 1.md')!;
      expect(resolvedActivity.resolvedParents.map((r) => r.title)).toEqual(['Phase 1']);
      expect(resolvedPhase.resolvedParents).toEqual([]);
    });

    it('returns unresolved ref for dangling parent links', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Nonexistent Phase]]' });

      const { nodes, unresolvedRefs } = resolveGraphEdges([activity], { hierarchy: { levels } });

      const resolvedActivity = nodes.find((n) => n.label === 'Activity 1.md')!;
      expect(resolvedActivity.resolvedParents).toEqual([]);
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

      const { nodes } = resolveGraphEdges([reqA, reqB, tool], { hierarchy: { levels } });

      const resolvedTool = nodes.find((n) => n.label === 'Tool X.md')!;
      expect(resolvedTool.resolvedParents.map((r) => r.title)).toContain('Req A');
      expect(resolvedTool.resolvedParents.map((r) => r.title)).toContain('Req B');
      expect(resolvedTool.resolvedParents).toHaveLength(2);
    });

    it('ignores non-string entries in array field', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const req = makeNode('Req A', 'Requirement');
      const tool = makeNode('Tool X', 'Tool', { fulfills: ['[[Req A]]', 42, null] });

      const { nodes } = resolveGraphEdges([req, tool], { hierarchy: { levels } });

      const resolvedTool = nodes.find((n) => n.label === 'Tool X.md')!;
      expect(resolvedTool.resolvedParents.map((r) => r.title)).toEqual(['Req A']);
    });

    it('returns invalid_shape unresolved ref when array field gets a string', () => {
      const levels = [makeLevel('Requirement'), makeLevel('Tool', { field: 'fulfills', multiple: true })];

      const tool = makeNode('Tool X', 'Tool', { fulfills: '[[Req A]]' }); // string, not array

      const { nodes, unresolvedRefs } = resolveGraphEdges([tool], { hierarchy: { levels } });

      const resolvedTool = nodes.find((n) => n.label === 'Tool X.md')!;
      expect(resolvedTool.resolvedParents).toEqual([]);
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

      const { nodes } = resolveGraphEdges([activity, reqA, reqB], { hierarchy: { levels } });

      const resolvedReqA = nodes.find((n) => n.label === 'Req A.md')!;
      const resolvedReqB = nodes.find((n) => n.label === 'Req B.md')!;
      const resolvedActivity = nodes.find((n) => n.label === 'Activity 1.md')!;
      expect(resolvedReqA.resolvedParents.map((r) => r.title)).toEqual(['Activity 1']);
      expect(resolvedReqB.resolvedParents.map((r) => r.title)).toEqual(['Activity 1']);
      expect(resolvedActivity.resolvedParents).toEqual([]);
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

      const { nodes } = resolveGraphEdges([activity1, activity2, sharedReq], { hierarchy: { levels } });

      const resolvedSharedReq = nodes.find((n) => n.label === 'Shared Req.md')!;
      expect(resolvedSharedReq.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(resolvedSharedReq.resolvedParents.map((r) => r.title)).toContain('Activity 2');
      expect(resolvedSharedReq.resolvedParents).toHaveLength(2);
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

      const { nodes } = resolveGraphEdges([phase, activity, reqA, reqB, tool], { hierarchy: { levels } });

      const r = (label: string) => nodes.find((n) => n.label === label)!;
      expect(r('Activity 1.md').resolvedParents.map((p) => p.title)).toEqual(['Phase 1']);
      expect(r('Req A.md').resolvedParents.map((p) => p.title)).toEqual(['Activity 1']);
      expect(r('Req B.md').resolvedParents.map((p) => p.title)).toEqual(['Activity 1']);
      expect(r('Tool X.md').resolvedParents.map((p) => p.title)).toEqual(['Req A']);
      expect(r('Phase 1.md').resolvedParents).toEqual([]);
    });
  });

  describe('root level is ignored', () => {
    it('does not process level 0 for edge resolution', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const phase = makeNode('Phase 1', 'Phase', { parent: '[[Activity 1]]' });
      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Phase 1]]' });

      const { nodes } = resolveGraphEdges([phase, activity], { hierarchy: { levels } });

      const resolvedPhase = nodes.find((n) => n.label === 'Phase 1.md')!;
      const resolvedActivity = nodes.find((n) => n.label === 'Activity 1.md')!;
      // Phase is level 0 (root) — its parent field is not processed
      expect(resolvedPhase.resolvedParents).toEqual([]);
      expect(resolvedActivity.resolvedParents.map((r) => r.title)).toEqual(['Phase 1']);
    });
  });

  describe('dangling refs return unresolved entries', () => {
    it('does not add to resolvedParents and returns unresolved ref when link target not found', () => {
      const levels = [makeLevel('Phase'), makeLevel('Activity')];

      const activity = makeNode('Activity 1', 'Activity', { parent: '[[Ghost Phase]]' });

      const { nodes, unresolvedRefs } = resolveGraphEdges([activity], { hierarchy: { levels } });

      const resolvedActivity = nodes.find((n) => n.label === 'Activity 1.md')!;
      expect(resolvedActivity.resolvedParents).toEqual([]);
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

      const { nodes } = resolveGraphEdges([project, task], { hierarchy: { levels }, relationships });

      const resolvedTask = nodes.find((n) => n.label === 'Task 1.md')!;
      const ref = resolvedTask.resolvedParents.find((r) => r.title === 'Project A');
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

      const { nodes } = resolveGraphEdges([project, resource], { hierarchy: { levels }, relationships });

      const resolvedResource = nodes.find((n) => n.label === 'Resource 1.md')!;
      const ref = resolvedResource.resolvedParents.find((r) => r.title === 'Project A');
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

      const { nodes } = resolveGraphEdges([activity, coreCapability, subCapability], { hierarchy: { levels } });

      const resolvedCore = nodes.find((n) => n.label === 'Core Capability.md')!;
      const resolvedSub = nodes.find((n) => n.label === 'Sub Capability.md')!;
      const resolvedActivity = nodes.find((n) => n.label === 'Activity 1.md')!;

      // Regular relationship: Activity → Capabilities via capabilities field on parent
      expect(resolvedCore.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(resolvedSub.resolvedParents.map((r) => r.title)).toContain('Activity 1');

      // Same-type relationship: Capability → Capability via parent field on child
      expect(resolvedSub.resolvedParents.map((r) => r.title)).toContain('Core Capability');

      expect(resolvedActivity.resolvedParents).toEqual([]);
      expect(resolvedCore.resolvedParents).toHaveLength(1);
      expect(resolvedSub.resolvedParents).toHaveLength(2); // Both Activity 1 and Core Capability
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

      const { nodes } = resolveGraphEdges([activity, toolA, toolB, toolC], { hierarchy: { levels } });

      const rTool = (name: string) => nodes.find((n) => n.label === `${name}.md`)!;

      // Regular relationships: Activity → Tools
      expect(rTool('Tool A').resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(rTool('Tool B').resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(rTool('Tool C').resolvedParents.map((r) => r.title)).toContain('Activity 1');

      // Same-type relationships: Tools → Tools via partOf field (multiple: false)
      expect(rTool('Tool B').resolvedParents.map((r) => r.title)).toContain('Tool A');
      expect(rTool('Tool C').resolvedParents.map((r) => r.title)).toContain('Tool B');

      expect(rTool('Tool A').resolvedParents).toHaveLength(1);
      expect(rTool('Tool B').resolvedParents).toHaveLength(2);
      expect(rTool('Tool C').resolvedParents).toHaveLength(2);
    });

    it('selfRef without selfRefField uses field for both relationships', () => {
      const levels = [makeLevel('Goal'), makeLevel('Objective', { selfRef: true })];

      const goal = makeNode('Goal 1', 'Goal');
      const objective1 = makeNode('Objective 1', 'Objective', { parent: '[[Goal 1]]' });
      const objective2 = makeNode('Objective 2', 'Objective', { parent: '[[Objective 1]]' });

      const { nodes } = resolveGraphEdges([goal, objective1, objective2], { hierarchy: { levels } });

      const rObj = (name: string) => nodes.find((n) => n.label === `${name}.md`)!;

      // Regular: Goal → Objective
      expect(rObj('Objective 1').resolvedParents.map((r) => r.title)).toContain('Goal 1');

      // Same-type: Objective → Objective (uses same field 'parent')
      expect(rObj('Objective 2').resolvedParents.map((r) => r.title)).toContain('Objective 1');

      expect(rObj('Goal 1').resolvedParents).toEqual([]);
      expect(rObj('Objective 1').resolvedParents).toHaveLength(1);
      expect(rObj('Objective 2').resolvedParents).toHaveLength(1);
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

      const { nodes, unresolvedRefs } = resolveGraphEdges([activity, capabilityA], { hierarchy: { levels } });

      const resolvedCapA = nodes.find((n) => n.label === 'Capability A.md')!;

      // Regular relationship resolves
      expect(resolvedCapA.resolvedParents.map((r) => r.title)).toContain('Activity 1');
      expect(resolvedCapA.resolvedParents).toHaveLength(1);

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
