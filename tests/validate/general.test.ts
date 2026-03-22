import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceDirectory, readSpaceOnAPage } from '../../src/plugins/markdown/read-space';
import { resolveGraphEdges } from '../../src/read/resolve-graph-edges';
import { bundledSchemasDir, createValidator, loadMetadata } from '../../src/schema/schema';
import { validateGraph } from '../../src/schema/validate-graph';
import type { SpaceNode, UnresolvedRef } from '../../src/types';
import { makePluginContext } from '../helpers/context';
import { makeLevel } from '../test-helpers';

const DEFAULT_SCHEMA_PATH = join(bundledSchemasDir, 'general.json');
const VALID_DIR = join(import.meta.dir, '../fixtures/general/valid-ost');
const INVALID_DIR = join(import.meta.dir, '../fixtures/general/invalid-ost');
const VALID_PAGE = join(import.meta.dir, '../fixtures/general/on-a-page-valid.md');

const validateNode = createValidator(DEFAULT_SCHEMA_PATH);
const metadata = loadMetadata(DEFAULT_SCHEMA_PATH);

describe('Schema validation', () => {
  describe('valid-ost nodes (readSpaceDirectory)', () => {
    let nodes: SpaceNode[];
    let unresolvedRefs: UnresolvedRef[];

    beforeAll(async () => {
      const result = await readSpaceDirectory(makePluginContext(VALID_DIR));
      nodes = result.nodes;
      unresolvedRefs = result.unresolvedRefs ?? [];
    });

    it('all 12 nodes pass schema validation', () => {
      expect(nodes).toHaveLength(12);
      for (const node of nodes) {
        expect(validateNode(node.schemaData)).toBe(true);
      }
    });

    it('has zero ref errors', () => {
      const { refErrors } = validateGraph(nodes, metadata, unresolvedRefs);
      expect(refErrors).toHaveLength(0);
    });
  });

  describe('on-a-page-valid.md nodes (readSpaceOnAPage)', () => {
    let nodes: SpaceNode[];

    beforeAll(() => {
      ({ nodes } = readSpaceOnAPage(makePluginContext(VALID_PAGE)));
    });

    it('all nodes pass schema validation', () => {
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(validateNode(node.schemaData)).toBe(true);
      }
    });
  });

  describe('invalid-ost nodes (readSpaceDirectory)', () => {
    let nodes: SpaceNode[];
    let unresolvedRefs: UnresolvedRef[];

    beforeAll(async () => {
      const result = await readSpaceDirectory(makePluginContext(INVALID_DIR));
      nodes = result.nodes;
      unresolvedRefs = result.unresolvedRefs ?? [];
    });

    it('missing-status.md fails schema validation (no status field)', () => {
      const node = nodes.find((n) => n.label === 'missing-status.md');
      expect(node).toBeDefined();
      expect(validateNode(node?.schemaData)).toBe(false);
    });

    it('vision-with-parent.md fails schema validation (vision forbids parent)', () => {
      const node = nodes.find((n) => n.label === 'vision-with-parent.md');
      expect(node).toBeDefined();
      expect(validateNode(node?.schemaData)).toBe(false);
    });

    it('dangling-parent.md passes schema validation (ref is a separate check)', () => {
      const node = nodes.find((n) => n.label === 'dangling-parent.md');
      expect(node).toBeDefined();
      expect(validateNode(node?.schemaData)).toBe(true);
    });

    it('detects dangling parent ref error for Nonexistent Node', () => {
      const { refErrors } = validateGraph(nodes, metadata, unresolvedRefs);
      expect(refErrors.some((e) => e.parent === '[[Nonexistent Node]]')).toBe(true);
    });
  });

  describe('link-target parent resolution', () => {
    it('resolves anchor/section wikilinks to canonical parent titles', () => {
      const nodes: SpaceNode[] = [
        {
          label: 'anchor_vision.md',
          schemaData: { title: 'anchor_vision', type: 'vision', status: 'active' },
          linkTargets: ['anchor_vision'],
          resolvedParents: [],
          resolvedType: 'vision',
        },
        {
          label: 'Our Mission',
          schemaData: {
            title: 'Our Mission',
            type: 'mission',
            status: 'identified',
            parent: '[[anchor_vision]]',
          },
          linkTargets: ['anchor_vision#Our Mission mission', 'anchor_vision#^mission'],
          resolvedParents: [],
          resolvedType: 'mission',
        },
        {
          label: 'Another Goal',
          schemaData: {
            title: 'Another Goal',
            type: 'goal',
            status: 'identified',
            parent: '[[anchor_vision#^mission]]',
          },
          linkTargets: ['anchor_vision#Another Goal goal1', 'anchor_vision#^goal1'],
          resolvedParents: [],
          resolvedType: 'goal',
        },
        {
          label: 'solution_page.md',
          schemaData: {
            title: 'solution_page',
            type: 'solution',
            status: 'identified',
            parent: '[[anchor_vision#^goal1]]',
          },
          linkTargets: ['solution_page'],
          resolvedParents: [],
          resolvedType: 'solution',
        },
      ];

      const refs1 = resolveGraphEdges(nodes, {
        hierarchy: { levels: [makeLevel('vision'), makeLevel('mission'), makeLevel('goal'), makeLevel('solution')] },
      });

      expect(nodes.find((n) => n.label === 'Another Goal')?.schemaData.parent).toBe('[[anchor_vision#^mission]]');
      expect(nodes.find((n) => n.label === 'Another Goal')?.resolvedParents[0]?.title).toBe('Our Mission');
      expect(nodes.find((n) => n.label === 'solution_page.md')?.schemaData.parent).toBe('[[anchor_vision#^goal1]]');
      expect(nodes.find((n) => n.label === 'solution_page.md')?.resolvedParents[0]?.title).toBe('Another Goal');

      const { refErrors } = validateGraph(nodes, metadata, refs1);
      expect(refErrors).toHaveLength(0);
    });

    it('keeps unresolved parent links untouched when no link target matches', () => {
      const nodes: SpaceNode[] = [
        {
          label: 'anchor_vision.md',
          schemaData: { title: 'anchor_vision', type: 'vision', status: 'active' },
          linkTargets: ['anchor_vision'],
          resolvedParents: [],
          resolvedType: 'vision',
        },
        {
          label: 'some-solution.md',
          schemaData: {
            title: 'some-solution',
            type: 'solution',
            status: 'identified',
            parent: '[[anchor_vision#^noanchor]]',
          },
          linkTargets: ['some-solution'],
          resolvedParents: [],
          resolvedType: 'solution',
        },
      ];

      const refs2 = resolveGraphEdges(nodes, {
        hierarchy: { levels: [makeLevel('vision'), makeLevel('mission'), makeLevel('goal'), makeLevel('solution')] },
      });

      const { refErrors } = validateGraph(nodes, metadata, refs2);
      expect(refErrors).toHaveLength(1);
      expect(refErrors[0]?.parent).toBe('[[anchor_vision#^noanchor]]');
    });

    it('does not resolve bare embedded-node title links when no page exists', () => {
      const nodes: SpaceNode[] = [
        {
          label: 'vision_page.md',
          schemaData: { title: 'vision_page', type: 'vision', status: 'active' },
          linkTargets: ['vision_page'],
          resolvedParents: [],
          resolvedType: 'vision',
        },
        {
          label: 'Embedded Goal',
          schemaData: {
            title: 'Embedded Goal',
            type: 'goal',
            status: 'identified',
            parent: '[[vision_page]]',
          },
          linkTargets: ['vision_page#Embedded Goal'],
          resolvedParents: [],
          resolvedType: 'goal',
        },
        {
          label: 'solution_page.md',
          schemaData: {
            title: 'solution_page',
            type: 'solution',
            status: 'identified',
            parent: '[[Embedded Goal]]',
          },
          linkTargets: ['solution_page'],
          resolvedParents: [],
          resolvedType: 'solution',
        },
      ];

      const refs3 = resolveGraphEdges(nodes, {
        hierarchy: { levels: [makeLevel('vision'), makeLevel('mission'), makeLevel('goal'), makeLevel('solution')] },
      });

      expect(nodes.find((n) => n.label === 'solution_page.md')?.resolvedParents).toHaveLength(0);
      const { refErrors } = validateGraph(nodes, metadata, refs3);
      expect(refErrors).toHaveLength(1);
      expect(refErrors[0]?.parent).toBe('[[Embedded Goal]]');
    });
  });

  describe('schema shape assertions (inline data)', () => {
    it('accepts a valid vision node', () => {
      expect(validateNode({ title: 'My Vision', type: 'vision', status: 'active' })).toBe(true);
    });

    it('rejects vision with a parent field', () => {
      expect(
        validateNode({
          title: 'V',
          type: 'vision',
          status: 'active',
          parent: '[[Y]]',
        }),
      ).toBe(false);
    });

    it('rejects an unknown status enum value', () => {
      expect(validateNode({ title: 'G', type: 'goal', status: 'unknown-value' })).toBe(false);
    });

    it('rejects priority p5 (not in enum)', () => {
      expect(
        validateNode({
          title: 'G',
          type: 'goal',
          status: 'active',
          priority: 'p5',
        }),
      ).toBe(false);
    });

    it('rejects impact score greater than 5', () => {
      expect(
        validateNode({
          title: 'O',
          type: 'opportunity',
          status: 'active',
          impact: 6,
        }),
      ).toBe(false);
    });

    it('rejects parent that is not a wikilink', () => {
      expect(
        validateNode({
          title: 'M',
          type: 'mission',
          status: 'active',
          parent: 'Not A Wikilink',
        }),
      ).toBe(false);
    });

    it('accepts mission with filename#section wikilink as parent', () => {
      expect(
        validateNode({
          title: 'M',
          type: 'mission',
          status: 'active',
          parent: '[[vision_page#Our Mission]]',
        }),
      ).toBe(true);
    });

    it('accepts goal with anchor-based wikilink as parent', () => {
      expect(
        validateNode({
          title: 'G',
          type: 'goal',
          status: 'active',
          parent: '[[vision_page#^mission]]',
        }),
      ).toBe(true);
    });
  });

  describe('duplicate title detection', () => {
    it('detects duplicate titles from same filename in different directories', async () => {
      const { nodes } = await readSpaceDirectory(
        makePluginContext(join(import.meta.dir, '../fixtures/general/duplicate-titles')),
      );
      const titleCounts = new Map<string, SpaceNode[]>();
      for (const node of nodes) {
        const title = node.schemaData.title as string;
        if (!titleCounts.has(title)) {
          titleCounts.set(title, []);
        }
        titleCounts.get(title)!.push(node);
      }

      const duplicates = Array.from(titleCounts.entries()).filter(([_, nodes]) => nodes.length > 1);
      expect(duplicates.length).toBeGreaterThan(0);
      expect(duplicates.some(([title]) => title === 'Same Title')).toBe(true);
    });

    it('detects duplicate titles from embedded nodes', () => {
      const { nodes } = readSpaceOnAPage(
        makePluginContext(join(import.meta.dir, '../fixtures/general/duplicate-embedded.md')),
      );
      const titleCounts = new Map<string, SpaceNode[]>();
      for (const node of nodes) {
        const title = node.schemaData.title as string;
        if (!titleCounts.has(title)) {
          titleCounts.set(title, []);
        }
        titleCounts.get(title)!.push(node);
      }

      const duplicates = Array.from(titleCounts.entries()).filter(([_, nodes]) => nodes.length > 1);
      expect(duplicates.length).toBeGreaterThan(0);
      expect(duplicates.some(([title, nodes]) => title === 'Duplicate Heading' && nodes.length === 2)).toBe(true);
    });
  });
});
