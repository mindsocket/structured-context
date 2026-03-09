import { describe, expect, it } from 'bun:test';
import type { SchemaMetadata, SpaceNode } from '../src/types';
import { validateHierarchy } from '../src/validate-hierarchy';
import { makeLevel } from './test-helpers';

describe('validate-hierarchy', () => {
  const buildNode = (title: string, type: string, parentTitle?: string): SpaceNode => ({
    label: `${title}.md`,
    schemaData: { title, type, status: 'active' },
    linkTargets: [title],
    resolvedParents: parentTitle ? [parentTitle] : [],
    resolvedType: type, // In tests, no alias resolution needed
  });

  describe('hierarchy with selfRef', () => {
    const hierarchy = ['vision', 'mission', 'goal', 'opportunity', 'solution', 'experiment'];
    const metadata: SchemaMetadata = {
      hierarchy,
      levels: hierarchy.map((t) => makeLevel(t, { selfRef: ['goal', 'opportunity', 'solution'].includes(t) })),
      aliases: {},
      allowSkipLevels: false,
    };

    it('passes when node has immediate parent in hierarchy', () => {
      const nodes: SpaceNode[] = [
        buildNode('My Vision', 'vision'),
        buildNode('My Mission', 'mission', 'My Vision'),
        buildNode('My Goal', 'goal', 'My Mission'),
      ];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(0);
    });

    it('passes when node has same-type parent if selfRef is true for that type', () => {
      const nodes: SpaceNode[] = [
        buildNode('Main Goal', 'goal'),
        buildNode('Sub Goal', 'goal', 'Main Goal'),
        buildNode('My Outcome', 'outcome', 'Sub Goal'),
        buildNode('Opportunity 1', 'opportunity', 'My Outcome'),
      ];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(0);
    });

    it('fails when node has same-type parent if selfRef is false for that type', () => {
      const nodes: SpaceNode[] = [buildNode('Mission 1', 'mission'), buildNode('Mission 2', 'mission', 'Mission 1')];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.nodeType).toBe('mission');
      expect(violations[0]?.parentType).toBe('mission');
      expect(violations[0]?.description).toContain('mission "Mission 2" cannot have mission "Mission 1" as parent');
    });

    it('fails when node skips hierarchy level', () => {
      const nodes: SpaceNode[] = [
        buildNode('My Vision', 'vision'),
        buildNode('My Goal', 'goal', 'My Vision'), // Skips mission
      ];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.nodeType).toBe('goal');
      expect(violations[0]?.parentType).toBe('vision');
      expect(violations[0]?.description).toContain('goal "My Goal" cannot have vision "My Vision" as parent');
    });

    it('fails when solution has goal as parent', () => {
      const nodes: SpaceNode[] = [buildNode('My Goal', 'goal'), buildNode('My Solution', 'solution', 'My Goal')];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.nodeType).toBe('solution');
      expect(violations[0]?.parentType).toBe('goal');
    });
  });

  describe('hierarchy with allowSkipLevels', () => {
    const hierarchy = ['vision', 'mission', 'goal', 'opportunity', 'solution', 'experiment'];
    const metadata: SchemaMetadata = {
      hierarchy,
      levels: hierarchy.map((t) => makeLevel(t, { selfRef: ['goal', 'opportunity', 'solution'].includes(t) })),
      aliases: {},
      allowSkipLevels: true,
    };

    it('allows skipping hierarchy levels when allowSkipLevels is true', () => {
      const nodes: SpaceNode[] = [
        buildNode('My Vision', 'vision'),
        buildNode('My Solution', 'solution', 'My Vision'), // Skips mission, goal, outcome, opportunity
      ];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(0);
    });

    it('still requires parent to be above child in hierarchy', () => {
      const nodes: SpaceNode[] = [
        buildNode('My Goal', 'goal'),
        buildNode('My Vision', 'vision', 'My Goal'), // Vision under goal - backwards
      ];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.nodeType).toBe('vision');
      expect(violations[0]?.parentType).toBe('goal');
    });
  });

  describe('edge cases', () => {
    const hierarchy = ['vision', 'mission', 'goal', 'opportunity', 'solution', 'experiment'];
    const metadata: SchemaMetadata = {
      hierarchy,
      levels: hierarchy.map((t) => makeLevel(t, { selfRef: ['goal', 'opportunity', 'solution'].includes(t) })),
      aliases: {},
      allowSkipLevels: false,
    };

    it('skips nodes not in hierarchy', () => {
      const nodes: SpaceNode[] = [buildNode('Dashboard', 'dashboard'), buildNode('Some Node', 'custom_type')];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(0);
    });

    it('skips nodes without a parent', () => {
      const nodes: SpaceNode[] = [buildNode('My Vision', 'vision'), buildNode('Orphan Goal', 'goal')];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(0);
    });

    it('skips nodes when parent node is not found', () => {
      // Missing parent references are already reported by the validate command.
      // Hierarchy validation only checks type relationships, so it skips nodes
      // whose parent cannot be found to avoid double-reporting.
      const nodes: SpaceNode[] = [buildNode('My Goal', 'goal', 'Nonexistent Parent')];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(0);
    });

    it('handles empty nodes array', () => {
      const violations = validateHierarchy([], metadata);
      expect(violations).toHaveLength(0);
    });
  });

  describe('violation format', () => {
    const hierarchy = ['vision', 'mission', 'goal'];
    const metadata: SchemaMetadata = {
      hierarchy,
      levels: hierarchy.map((t) => makeLevel(t)),
      aliases: {},
      allowSkipLevels: false,
    };

    it('includes all required fields in violation', () => {
      const nodes: SpaceNode[] = [buildNode('My Vision', 'vision'), buildNode('My Goal', 'goal', 'My Vision')];

      const violations = validateHierarchy(nodes, metadata);
      expect(violations).toHaveLength(1);

      const v = violations[0]!;
      expect(v.file).toBe('My Goal.md');
      expect(v.nodeType).toBe('goal');
      expect(v.nodeTitle).toBe('My Goal');
      expect(v.parentType).toBe('vision');
      expect(v.parentTitle).toBe('My Vision');
      expect(v.description).toBe('Invalid parent: goal "My Goal" cannot have vision "My Vision" as parent');
    });
  });
});
