import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceOnAPage } from '../../../src/plugins/markdown/read-space';
import { resolveGraphEdges } from '../../../src/read/resolve-graph-edges';
import { bundledSchemasDir, loadMetadata } from '../../../src/schema/schema';
import type { ParseIssue, SpaceNode } from '../../../src/types';
import { makePluginContext } from '../../helpers/context';

const metadata = loadMetadata(join(bundledSchemasDir, 'strategy_general.json'));

const VALID_PAGE = join(import.meta.dir, '../../fixtures/general/on-a-page-valid.md');
const SKIP_PAGE = join(import.meta.dir, '../../fixtures/general/on-a-page-heading-skip.md');

describe('readSpaceOnAPage - on-a-page-valid.md (space_on_a_page)', () => {
  let resolvedNodes: SpaceNode[];
  let parseIssues: ParseIssue[];
  let diagnostics: Record<string, number | string | string[]>;

  beforeAll(() => {
    const result = readSpaceOnAPage(makePluginContext(VALID_PAGE));
    ({ nodes: resolvedNodes } = resolveGraphEdges(result.nodes, metadata));
    parseIssues = result.parseIssues;
    diagnostics = result.diagnostics;
  });

  describe('heading type inference', () => {
    it('infers H1 as vision with no parent', () => {
      const node = resolvedNodes.find((n) => n.label === 'Personal Vision');
      expect(node?.schemaData.type).toBe('vision');
      expect(node?.schemaData.parent).toBeUndefined();
    });

    it('infers H2 as mission with parent from H1', () => {
      const node = resolvedNodes.find((n) => n.label === 'Personal Mission');
      expect(node?.schemaData.type).toBe('mission');
      expect(node?.resolvedParents[0]?.title).toBe('Personal Vision');
      expect(node?.schemaData.parent).toContain('[[on-a-page-valid#');
    });

    it('infers H3 as goal with parent from H2', () => {
      const node = resolvedNodes.find((n) => n.label === 'Career Growth');
      expect(node?.schemaData.type).toBe('goal');
      expect(node?.resolvedParents[0]?.title).toBe('Personal Mission');
      expect(node?.schemaData.parent).toContain('[[on-a-page-valid#');
    });

    it('infers H4 as opportunity with parent from H3', () => {
      const node = resolvedNodes.find((n) => n.label === 'Technical Skills');
      expect(node?.schemaData.type).toBe('opportunity');
      expect(node?.resolvedParents[0]?.title).toBe('Career Growth');
      expect(node?.schemaData.parent).toContain('[[on-a-page-valid#');
    });

    it('infers H5 as solution with parent from H4', () => {
      const node = resolvedNodes.find((n) => n.label === 'Build a Side Project');
      expect(node?.schemaData.type).toBe('solution');
      expect(node?.resolvedParents[0]?.title).toBe('Technical Skills');
      expect(node?.schemaData.parent).toContain('[[on-a-page-valid#');
    });
  });

  describe('default status', () => {
    it('applies DEFAULT_STATUS to heading nodes without explicit status', () => {
      const node = resolvedNodes.find((n) => n.label === 'Build a Side Project');
      expect(node?.schemaData.status).toBe('identified');
    });
  });

  describe('inline bracketed fields', () => {
    it('extracts [priority:: p2] from Career Growth heading and strips it from title', () => {
      const node = resolvedNodes.find((n) => n.label === 'Career Growth');
      expect(node?.schemaData.priority).toBe('p2');
      expect(node?.schemaData.title).toBe('Career Growth');
    });
  });

  describe('unbracketed paragraph fields', () => {
    it('extracts status:: active on Personal Vision overriding DEFAULT_STATUS', () => {
      const node = resolvedNodes.find((n) => n.label === 'Personal Vision');
      expect(node?.schemaData.status).toBe('active');
    });
  });

  describe('YAML code block', () => {
    it('merges YAML block fields into Personal Mission', () => {
      const node = resolvedNodes.find((n) => n.label === 'Personal Mission');
      expect(node?.schemaData.status).toBe('active');
      expect(node?.schemaData.summary).toBe('A mission-level summary set via YAML block');
    });
  });

  describe('typed bullets', () => {
    it('includes Learn TypeScript and Read OSTS Book as nodes', () => {
      const labels = resolvedNodes.map((n) => n.label);
      expect(labels).toContain('Learn TypeScript');
      expect(labels).toContain('Read OSTS Book');
    });

    it('sets parent and summary on Learn TypeScript from dash separator', () => {
      const node = resolvedNodes.find((n) => n.label === 'Learn TypeScript');
      expect(node?.resolvedParents[0]?.title).toBe('Technical Skills');
      expect(node?.schemaData.parent).toContain('[[on-a-page-valid#');
      expect(node?.schemaData.summary).toBe('Master TypeScript for tool development');
    });

    it('applies DEFAULT_STATUS to typed bullet without explicit override', () => {
      const node = resolvedNodes.find((n) => n.label === 'Read OSTS Book');
      expect(node?.schemaData.status).toBe('identified');
    });
  });

  describe('preamble and terminator', () => {
    it('counts at least one preamble node', () => {
      expect(diagnostics?.preambleNodeCount).toBeGreaterThanOrEqual(1);
    });

    it('records Archived Vision as a terminated warning in parseIssues', () => {
      const issue = parseIssues.find((i) => i.file === 'Archived Vision');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
      expect(issue?.type).toBe('terminated');
    });

    it('does not include Archived Vision in nodes', () => {
      const labels = resolvedNodes.map((n) => n.label);
      expect(labels).not.toContain('Archived Vision');
    });
  });

  describe('heading level skip error', () => {
    it('throws when heading level is skipped (H1 to H3)', () => {
      expect(() => readSpaceOnAPage(makePluginContext(SKIP_PAGE))).toThrow(/Heading level skipped/);
    });
  });

  describe('typed file rejection', () => {
    it('throws when given a typed node file instead of space_on_a_page', () => {
      const typedFile = join(import.meta.dir, '../../fixtures/general/valid-ost/Personal Vision.md');
      expect(() => readSpaceOnAPage(makePluginContext(typedFile))).toThrow(/Expected a space_on_a_page file/);
    });
  });
});
