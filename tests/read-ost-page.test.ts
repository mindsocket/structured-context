import { beforeAll, describe, expect, it } from 'bun:test';
import { basename, join } from 'node:path';
import { readOstPage } from '../src/read-ost-page.js';
import type { OstPageReadResult } from '../src/types.js';

const VALID_PAGE = join(import.meta.dir, 'fixtures/on-a-page-valid.md');
const SKIP_PAGE = join(import.meta.dir, 'fixtures/on-a-page-heading-skip.md');
const HYBRID_PAGE = join(import.meta.dir, 'fixtures/hybrid-page-valid.md');
const HYBRID_ANCHOR_PAGE = join(import.meta.dir, 'fixtures/hybrid-anchor-type.md');

describe('readOstPage - on-a-page-valid.md (ost_on_a_page)', () => {
  let result: OstPageReadResult;

  beforeAll(() => {
    result = readOstPage(VALID_PAGE);
  });

  describe('heading type inference', () => {
    it('infers H1 as vision with no parent', () => {
      const node = result.nodes.find((n) => n.label === 'Personal Vision');
      expect(node?.data.type).toBe('vision');
      expect(node?.data.parent).toBeUndefined();
    });

    it('infers H2 as mission with parent from H1', () => {
      const node = result.nodes.find((n) => n.label === 'Personal Mission');
      expect(node?.data.type).toBe('mission');
      expect(node?.data.parent).toBe('[[Personal Vision]]');
    });

    it('infers H3 as goal with parent from H2', () => {
      const node = result.nodes.find((n) => n.label === 'Career Growth');
      expect(node?.data.type).toBe('goal');
      expect(node?.data.parent).toBe('[[Personal Mission]]');
    });

    it('infers H4 as opportunity with parent from H3', () => {
      const node = result.nodes.find((n) => n.label === 'Technical Skills');
      expect(node?.data.type).toBe('opportunity');
      expect(node?.data.parent).toBe('[[Career Growth]]');
    });

    it('infers H5 as solution with parent from H4', () => {
      const node = result.nodes.find((n) => n.label === 'Build a Side Project');
      expect(node?.data.type).toBe('solution');
      expect(node?.data.parent).toBe('[[Technical Skills]]');
    });
  });

  describe('default status', () => {
    it('applies DEFAULT_STATUS to heading nodes without explicit status', () => {
      const node = result.nodes.find((n) => n.label === 'Build a Side Project');
      expect(node?.data.status).toBe('identified');
    });
  });

  describe('inline bracketed fields', () => {
    it('extracts [priority:: p2] from Career Growth heading and strips it from title', () => {
      const node = result.nodes.find((n) => n.label === 'Career Growth');
      expect(node?.data.priority).toBe('p2');
      expect(node?.data.title).toBe('Career Growth');
    });
  });

  describe('unbracketed paragraph fields', () => {
    it('extracts status:: active on Personal Vision overriding DEFAULT_STATUS', () => {
      const node = result.nodes.find((n) => n.label === 'Personal Vision');
      expect(node?.data.status).toBe('active');
    });
  });

  describe('YAML code block', () => {
    it('merges YAML block fields into Personal Mission', () => {
      const node = result.nodes.find((n) => n.label === 'Personal Mission');
      expect(node?.data.status).toBe('active');
      expect(node?.data.summary).toBe('A mission-level summary set via YAML block');
    });
  });

  describe('typed bullets', () => {
    it('includes Learn TypeScript and Read OSTS Book as nodes', () => {
      const labels = result.nodes.map((n) => n.label);
      expect(labels).toContain('Learn TypeScript');
      expect(labels).toContain('Read OSTS Book');
    });

    it('sets parent and summary on Learn TypeScript from dash separator', () => {
      const node = result.nodes.find((n) => n.label === 'Learn TypeScript');
      expect(node?.data.parent).toBe('[[Technical Skills]]');
      expect(node?.data.summary).toBe('Master TypeScript for tool development');
    });

    it('applies DEFAULT_STATUS to typed bullet without explicit override', () => {
      const node = result.nodes.find((n) => n.label === 'Read OSTS Book');
      expect(node?.data.status).toBe('identified');
    });
  });

  describe('preamble and terminator', () => {
    it('counts at least one preamble node', () => {
      expect(result.diagnostics.preambleNodeCount).toBeGreaterThanOrEqual(1);
    });

    it('records Archived Vision in terminatedHeadings', () => {
      expect(result.diagnostics.terminatedHeadings).toContain('Archived Vision');
    });

    it('does not include Archived Vision in nodes', () => {
      const labels = result.nodes.map((n) => n.label);
      expect(labels).not.toContain('Archived Vision');
    });
  });

  describe('heading level skip error', () => {
    it('throws when heading level is skipped (H1 to H3)', () => {
      expect(() => readOstPage(SKIP_PAGE)).toThrow(/Heading level skipped/);
    });
  });
});

describe('readOstPage - hybrid-page-valid.md (type: vision with embedded nodes)', () => {
  let result: OstPageReadResult;

  beforeAll(() => {
    result = readOstPage(HYBRID_PAGE);
  });

  it('includes the file itself as the first node', () => {
    const fileNode = result.nodes[0];
    expect(fileNode?.label).toBe(basename(HYBRID_PAGE));
    expect(fileNode?.data.type).toBe('vision');
    expect(fileNode?.data.title).toBe('hybrid-page-valid');
  });

  it('includes embedded mission as a node', () => {
    const node = result.nodes.find((n) => n.label === 'The Mission');
    expect(node?.data.type).toBe('mission');
    expect(node?.data.title).toBe('The Mission');
  });

  it('sets parent of embedded mission to the vision file title', () => {
    const node = result.nodes.find((n) => n.label === 'The Mission');
    expect(node?.data.parent).toBe('[[hybrid-page-valid]]');
  });

  it('stores anchor on embedded mission node', () => {
    const node = result.nodes.find((n) => n.label === 'The Mission');
    expect(node?.data.anchor).toBe('missionanchor');
  });

  it('includes embedded goal as a node nested under the mission', () => {
    const node = result.nodes.find((n) => n.label === 'The Goal');
    expect(node?.data.type).toBe('goal');
    expect(node?.data.parent).toBe('[[The Mission]]');
  });

  it('returns 3 nodes total (file + 2 embedded)', () => {
    expect(result.nodes).toHaveLength(3);
  });
});

describe('readOstPage - hybrid-anchor-type.md (anchor-implied type, no [type::])', () => {
  let result: OstPageReadResult;

  beforeAll(() => {
    result = readOstPage(HYBRID_ANCHOR_PAGE);
  });

  it('infers type "mission" from ^mission anchor', () => {
    const node = result.nodes.find((n) => n.label === 'Our Mission');
    expect(node?.data.type).toBe('mission');
  });

  it('infers type "goal" from ^goal1 anchor', () => {
    const node = result.nodes.find((n) => n.label === 'Another Goal');
    expect(node?.data.type).toBe('goal');
  });

  it('stores anchors on the nodes', () => {
    expect(result.nodes.find((n) => n.label === 'Our Mission')?.data.anchor).toBe('mission');
    expect(result.nodes.find((n) => n.label === 'Another Goal')?.data.anchor).toBe('goal1');
  });

  it('untyped H1 preamble heading is not included as a node', () => {
    expect(result.nodes.map((n) => n.label)).not.toContain('Preamble (ignored)');
  });
});
