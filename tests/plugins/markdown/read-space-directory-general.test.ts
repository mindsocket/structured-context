import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceDirectory } from '../../../src/plugins/markdown/read-space';
import type { ParseResult } from '../../../src/plugins/util';
import { resolveGraphEdges } from '../../../src/read/resolve-graph-edges';
import { bundledSchemasDir, loadMetadata } from '../../../src/schema/schema';
import type { SpaceNode } from '../../../src/types';
import { makePluginContext } from '../../helpers/context';

const metadata = loadMetadata(join(bundledSchemasDir, 'strategy_general.json'));

const VALID_DIR = join(import.meta.dir, '../../fixtures/general/valid-ost');
const INVALID_DIR = join(import.meta.dir, '../../fixtures/general/invalid-ost');

describe('readSpaceDirectory', () => {
  describe('valid-ost directory', () => {
    let result: ParseResult;

    beforeAll(async () => {
      result = await readSpaceDirectory(makePluginContext(VALID_DIR));
    });

    it('returns 12 OST nodes (5 original + vision_page + 2 embedded + solution_page + anchor_vision + 2 embedded)', () => {
      expect(result.nodes).toHaveLength(12);
    });

    it('injects title from filename for file-based nodes', () => {
      const vision = result.nodes.find((n) => n.label === 'Personal Vision.md');
      expect(vision?.schemaData.title).toBe('Personal Vision');
    });

    it('reports no-frontmatter.md as a warning with type empty', () => {
      const issue = result.parseIssues.find((i) => i.file === 'no-frontmatter.md');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
      expect(issue?.type).toBe('empty');
    });

    it('reports meeting-notes.md as a warning with type no-type', () => {
      const issue = result.parseIssues.find((i) => i.file === 'meeting-notes.md');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
      expect(issue?.type).toBe('no-type');
    });

    it('skipped files do not appear in nodes', () => {
      expect(result.nodes.every((n) => n.label !== 'no-frontmatter.md')).toBe(true);
    });

    it('nonSpace files do not appear in nodes', () => {
      expect(result.nodes.every((n) => n.label !== 'meeting-notes.md')).toBe(true);
    });

    it('preserves numeric frontmatter fields on Technical Skills', () => {
      const ts = result.nodes.find((n) => n.label === 'Technical Skills.md');
      expect(ts?.schemaData.impact).toBe(4);
      expect(ts?.schemaData.feasibility).toBe(3);
      expect(ts?.schemaData.resources).toBe(2);
      expect(ts?.schemaData.priority).toBe('p3');
    });

    it('Community OST.md (ost_on_a_page) is excluded from nodes', () => {
      expect(result.nodes.every((n) => n.label !== 'Community OST.md')).toBe(true);
    });

    it('Community OST.md does not appear in parseIssues', () => {
      expect(result.parseIssues.some((i) => i.file === 'Community OST.md')).toBe(false);
    });
  });

  describe('embedded nodes in typed pages', () => {
    let resolvedNodes: SpaceNode[];

    beforeAll(async () => {
      const result = await readSpaceDirectory(makePluginContext(VALID_DIR));
      ({ nodes: resolvedNodes } = resolveGraphEdges(result.nodes, metadata));
    });

    it('includes vision_page.md as its own node', () => {
      const node = resolvedNodes.find((n) => n.label === 'vision_page.md');
      expect(node).toBeDefined();
      expect(node?.schemaData.type).toBe('vision');
      expect(node?.schemaData.title).toBe('vision_page');
    });

    it('extracts embedded mission with plain title', () => {
      const node = resolvedNodes.find((n) => n.label === 'Embedded Mission');
      expect(node).toBeDefined();
      expect(node?.schemaData.type).toBe('mission');
      expect(node?.schemaData.title).toBe('Embedded Mission');
    });

    it('embedded mission parent points to the containing page', () => {
      const node = resolvedNodes.find((n) => n.label === 'Embedded Mission');
      expect(node?.schemaData.parent).toBe('[[vision_page]]');
      expect(node?.resolvedParents[0]?.title).toBe('vision_page');
    });

    it('stores navigation targets for embedded mission', () => {
      const node = resolvedNodes.find((n) => n.label === 'Embedded Mission');
      expect(node?.linkTargets).toContain('vision_page#^embmission');
      expect(node?.linkTargets).toContain('vision_page#[type mission] Embedded Mission embmission');
    });

    it('extracts nested embedded goal with plain title', () => {
      const node = resolvedNodes.find((n) => n.label === 'Embedded Goal');
      expect(node).toBeDefined();
      expect(node?.schemaData.type).toBe('goal');
    });

    it('embedded goal parent is stored as an implied section target and resolved to title', () => {
      const node = resolvedNodes.find((n) => n.label === 'Embedded Goal');
      expect(node?.schemaData.parent).toBe('[[vision_page#[type mission] Embedded Mission embmission]]');
      expect(node?.resolvedParents[0]?.title).toBe('Embedded Mission');
    });

    it('solution_page.md keeps source parent link and resolves to embedded goal title', () => {
      const node = resolvedNodes.find((n) => n.label === 'solution_page.md');
      expect(node?.schemaData.parent).toBe('[[vision_page#^embgoal]]');
      expect(node?.resolvedParents[0]?.title).toBe('Embedded Goal');
    });
  });

  describe('anchor-implied type inference', () => {
    let resolvedNodes: SpaceNode[];

    beforeAll(async () => {
      const result = await readSpaceDirectory(makePluginContext(VALID_DIR));
      ({ nodes: resolvedNodes } = resolveGraphEdges(result.nodes, metadata));
    });

    it('infers type "mission" from ^mission anchor', () => {
      const node = resolvedNodes.find((n) => n.label === 'Our Mission');
      expect(node?.schemaData.type).toBe('mission');
      expect(node?.schemaData.title).toBe('Our Mission');
    });

    it('infers type "goal" from ^goal1 anchor', () => {
      const node = resolvedNodes.find((n) => n.label === 'Another Goal');
      expect(node?.schemaData.type).toBe('goal');
      expect(node?.schemaData.title).toBe('Another Goal');
    });

    it('stores both section and anchor navigation targets when heading has a block anchor', () => {
      const mission = resolvedNodes.find((n) => n.label === 'Our Mission');
      const goal = resolvedNodes.find((n) => n.label === 'Another Goal');
      expect(mission?.linkTargets).toContain('anchor_vision#^mission');
      expect(mission?.linkTargets).toContain('anchor_vision#Our Mission mission');
      expect(goal?.linkTargets).toContain('anchor_vision#^goal1');
      expect(goal?.linkTargets).toContain('anchor_vision#Another Goal goal1');
    });

    it('does not include untyped preamble heading as a node', () => {
      expect(resolvedNodes.map((n) => n.label)).not.toContain('Preamble (ignored)');
    });

    it('resolves section/anchor parent links to canonical parent titles without mutating source links', () => {
      const goal = resolvedNodes.find((n) => n.label === 'Embedded Goal');
      const solutionPage = resolvedNodes.find((n) => n.label === 'solution_page.md');
      expect(goal?.schemaData.parent).toBe('[[vision_page#[type mission] Embedded Mission embmission]]');
      expect(goal?.resolvedParents[0]?.title).toBe('Embedded Mission');
      expect(solutionPage?.schemaData.parent).toBe('[[vision_page#^embgoal]]');
      expect(solutionPage?.resolvedParents[0]?.title).toBe('Embedded Goal');
    });
  });

  describe('invalid-ost directory', () => {
    it('returns all 3 nodes regardless of schema validity', async () => {
      const result = await readSpaceDirectory(makePluginContext(INVALID_DIR));
      expect(result.nodes).toHaveLength(3);
    });
  });

  describe('YAML parse errors', () => {
    it('reports bad-yaml.md as an error parse issue instead of crashing', async () => {
      const result = await readSpaceDirectory(makePluginContext(INVALID_DIR));
      const issue = result.parseIssues.find((i) => i.file === 'bad-yaml.md');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('error');
      expect(issue?.type).toBe('parse');
      expect(issue?.message).toBeTruthy();
    });

    it('continues parsing other files after a YAML error', async () => {
      const result = await readSpaceDirectory(makePluginContext(INVALID_DIR));
      expect(result.nodes).toHaveLength(3);
    });
  });
});
