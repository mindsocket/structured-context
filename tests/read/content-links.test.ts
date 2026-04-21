import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readSpaceDirectory } from '../../src/plugins/markdown/read-space';
import { resolveGraphEdges } from '../../src/read/resolve-graph-edges';
import { bundledSchemasDir, loadMetadata } from '../../src/schema/schema';
import type { ContentLink, SpaceNode } from '../../src/types';
import { makePluginContext } from '../helpers/context';

const VALID_DIR = join(import.meta.dir, '../fixtures/general/valid-ost');
const metadata = loadMetadata(join(bundledSchemasDir, 'strategy_general.json'));

// ---------------------------------------------------------------------------
// Unit tests: extract-content-links utilities
// ---------------------------------------------------------------------------

import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  extractLinksFromAstNode,
  extractLinksFromFrontmatter,
  extractLinksFromText,
  getEdgeFieldNames,
} from '../../src/plugins/markdown/extract-content-links';

function parseBody(markdown: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
}

describe('extractLinksFromText', () => {
  it('extracts wikilinks', () => {
    const links = extractLinksFromText('See [[Personal Vision]] for more.');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: 'Personal Vision',
      target: 'Personal Vision',
      action: 'link',
      linkSyntax: 'wikilink',
    });
  });

  it('extracts wikilinks with anchors', () => {
    const links = extractLinksFromText('Go to [[vision_page#^embmission]].');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ target: 'vision_page', anchor: '^embmission', linkSyntax: 'wikilink' });
  });

  it('extracts wikilinks with aliases', () => {
    const links = extractLinksFromText('See [[Personal Vision|our vision]].');
    expect(links[0]).toMatchObject({ text: 'our vision', target: 'Personal Vision' });
  });

  it('extracts embed wikilinks', () => {
    const links = extractLinksFromText('![[image.png]]');
    expect(links[0]).toMatchObject({ action: 'embed', target: 'image.png', linkSyntax: 'wikilink' });
  });

  it('extracts markdown links', () => {
    const links = extractLinksFromText('[click here](https://example.com)');
    expect(links[0]).toMatchObject({ text: 'click here', target: 'https://example.com', linkSyntax: 'markdown' });
  });

  it('extracts markdown image embeds', () => {
    const links = extractLinksFromText('![alt text](https://example.com/img.png)');
    expect(links[0]).toMatchObject({ action: 'embed', text: 'alt text', target: 'https://example.com/img.png' });
  });

  it('extracts multiple mixed links from one string', () => {
    const links = extractLinksFromText('See [[A]] and [B](https://b.com) and [[C]].');
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.target)).toEqual(['A', 'C', 'https://b.com']);
  });
});

describe('extractLinksFromAstNode', () => {
  it('extracts a markdown link node', () => {
    const tree = parseBody('[visit](https://example.com)');
    const para = tree.children[0]!;
    const links = extractLinksFromAstNode(para);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: 'visit',
      target: 'https://example.com',
      action: 'link',
      linkSyntax: 'markdown',
    });
  });

  it('extracts a markdown image node', () => {
    const tree = parseBody('![alt](https://example.com/pic.jpg)');
    const links = extractLinksFromAstNode(tree.children[0]!);
    expect(links[0]).toMatchObject({ action: 'embed', text: 'alt', target: 'https://example.com/pic.jpg' });
  });

  it('extracts wikilinks from text nodes within a paragraph', () => {
    const tree = parseBody('See [[My Goal]] for context.');
    const links = extractLinksFromAstNode(tree.children[0]!);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ target: 'My Goal', linkSyntax: 'wikilink' });
  });

  it('extracts both markdown links and wikilinks from a paragraph', () => {
    const tree = parseBody('See [[My Goal]] and [external](https://example.com).');
    const links = extractLinksFromAstNode(tree.children[0]!);
    expect(links).toHaveLength(2);
    const wikilink = links.find((l) => l.linkSyntax === 'wikilink');
    const mdLink = links.find((l) => l.linkSyntax === 'markdown');
    expect(wikilink?.target).toBe('My Goal');
    expect(mdLink?.target).toBe('https://example.com');
  });
});

describe('extractLinksFromFrontmatter', () => {
  const edgeFields = new Set(['parent', 'parents']);

  it('extracts links from string fields', () => {
    const data = { title: 'My Node', source: 'See [[Reference]] and https://example.com' };
    const links = extractLinksFromFrontmatter(data, edgeFields);
    expect(links.some((l) => l.target === 'Reference')).toBe(true);
  });

  it('skips edge fields', () => {
    const data = { title: 'My Node', parent: '[[Parent Node]]', source: '[[Reference]]' };
    const links = extractLinksFromFrontmatter(data, edgeFields);
    expect(links.some((l) => l.target === 'Parent Node')).toBe(false);
    expect(links.some((l) => l.target === 'Reference')).toBe(true);
  });

  it('extracts links from string array fields', () => {
    const data = { tags: ['[[Tag A]]', '[[Tag B]]'] };
    const links = extractLinksFromFrontmatter(data, edgeFields);
    expect(links.map((l) => l.target)).toEqual(expect.arrayContaining(['Tag A', 'Tag B']));
  });
});

describe('getEdgeFieldNames', () => {
  it('collects hierarchy and relationship field names', () => {
    const fields = getEdgeFieldNames(metadata);
    expect(fields.has('parent')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: contentLinks on parsed nodes, resolvedLinks on SpaceNodes
// ---------------------------------------------------------------------------

describe('contentLinks and resolvedLinks integration', () => {
  let nodes: SpaceNode[];

  beforeAll(async () => {
    const result = await readSpaceDirectory(makePluginContext(VALID_DIR));
    ({ nodes } = resolveGraphEdges(result.nodes, metadata));
  });

  it('every SpaceNode has a resolvedLinks array', () => {
    for (const node of nodes) {
      expect(Array.isArray(node.resolvedLinks)).toBe(true);
    }
  });

  describe('links_opportunity node', () => {
    let node: SpaceNode;

    beforeAll(() => {
      node = nodes.find((n) => n.label === 'links_opportunity.md')!;
      expect(node).toBeDefined();
    });

    it('classifies the frontmatter source URL as external', () => {
      const link = node.resolvedLinks.find((l) => l.target === 'https://example.com/research');
      expect(link).toBeDefined();
      expect(link?.location).toBe('external');
      expect(link?.action).toBe('link');
    });

    it('classifies a content wikilink to a known node as internal node', () => {
      const link = node.resolvedLinks.find((l) => l.target === 'Personal Mission');
      expect(link).toBeDefined();
      expect(link?.location).toBe('node');
    });

    it('classifies a wikilink to an unknown target as internal', () => {
      const link = node.resolvedLinks.find((l) => l.target === 'missing-page');
      expect(link).toBeDefined();
      expect(link?.location).toBe('internal');
    });

    it('classifies a plain https link as external', () => {
      const link = node.resolvedLinks.find((l) => l.target === 'https://www.example.com/tool');
      expect(link).toBeDefined();
      expect(link?.location).toBe('external');
      expect(link?.text).toBe('external resource');
    });

    it('classifies an obsidian:// link as protocol', () => {
      const link = node.resolvedLinks.find((l) => l.target.startsWith('obsidian://'));
      expect(link).toBeDefined();
      expect(link?.location).toBe('protocol');
    });

    it('classifies a file:// link as system', () => {
      const link = node.resolvedLinks.find((l) => l.target.startsWith('file://'));
      expect(link).toBeDefined();
      expect(link?.location).toBe('system');
    });

    it('classifies a relative path link as internal', () => {
      const link = node.resolvedLinks.find((l) => l.target === './other-note.md');
      expect(link).toBeDefined();
      expect(link?.location).toBe('internal');
    });

    it('classifies an embed wikilink with action embed', () => {
      const link = node.resolvedLinks.find((l) => l.target === 'embedded-image.png');
      expect(link).toBeDefined();
      expect(link?.action).toBe('embed');
      expect(link?.location).toBe('internal');
    });

    it('does not include the parent edge field wikilink', () => {
      // parent: "[[Personal Vision]]" is a graph edge — should not appear in resolvedLinks
      const parentLinks = node.resolvedLinks.filter((l) => l.target === 'Personal Vision');
      expect(parentLinks).toHaveLength(0);
    });
  });

  it('nodes without body links have empty resolvedLinks (or only frontmatter links)', () => {
    const vision = nodes.find((n) => n.label === 'Personal Vision.md')!;
    expect(vision).toBeDefined();
    // Personal Vision has no links in body content — may have frontmatter links if any fields contain them
    // The summary field is plain text, so resolvedLinks should be empty
    expect(vision.resolvedLinks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: classifyContentLink via resolveGraphEdges
// ---------------------------------------------------------------------------

import { resolveGraphEdges as resolveEdges } from '../../src/read/resolve-graph-edges';

describe('link location classification', () => {
  const levels = [
    { type: 'goal', field: 'parent', fieldOn: 'child' as const, multiple: false, selfRef: false },
    { type: 'solution', field: 'parent', fieldOn: 'child' as const, multiple: false, selfRef: false },
  ];
  const metadata = { hierarchy: { levels } };

  function makeBaseNode(title: string, type: string, links: ContentLink[] = []) {
    return {
      label: `${title}.md`,
      title,
      type,
      schemaData: { title, type },
      linkTargets: [title],
      contentLinks: links,
    };
  }

  it('classifies wikilink to known node as node', () => {
    const goal = makeBaseNode('My Goal', 'goal');
    const solution = makeBaseNode('My Solution', 'solution', [
      { text: 'My Goal', target: 'My Goal', action: 'link', linkSyntax: 'wikilink' },
    ]);
    const { nodes } = resolveEdges([goal, solution], metadata);
    const sol = nodes.find((n) => n.title === 'My Solution')!;
    expect(sol.resolvedLinks[0]?.location).toBe('node');
  });

  it('classifies wikilink to unknown target as internal', () => {
    const solution = makeBaseNode('My Solution', 'solution', [
      { text: 'Unknown', target: 'Unknown', action: 'link', linkSyntax: 'wikilink' },
    ]);
    const { nodes } = resolveEdges([solution], metadata);
    expect(nodes[0]!.resolvedLinks[0]?.location).toBe('internal');
  });

  it('classifies https URL as external', () => {
    const solution = makeBaseNode('My Solution', 'solution', [
      { text: 'Link', target: 'https://example.com', action: 'link', linkSyntax: 'markdown' },
    ]);
    const { nodes } = resolveEdges([solution], metadata);
    expect(nodes[0]!.resolvedLinks[0]?.location).toBe('external');
  });

  it('classifies http URL as external', () => {
    const solution = makeBaseNode('My Solution', 'solution', [
      { text: 'Link', target: 'http://example.com', action: 'link', linkSyntax: 'markdown' },
    ]);
    const { nodes } = resolveEdges([solution], metadata);
    expect(nodes[0]!.resolvedLinks[0]?.location).toBe('external');
  });

  it('classifies file:// URL as system', () => {
    const solution = makeBaseNode('My Solution', 'solution', [
      { text: 'File', target: 'file:///path/to/file.txt', action: 'link', linkSyntax: 'markdown' },
    ]);
    const { nodes } = resolveEdges([solution], metadata);
    expect(nodes[0]!.resolvedLinks[0]?.location).toBe('system');
  });

  it('classifies obsidian:// URL as protocol', () => {
    const solution = makeBaseNode('My Solution', 'solution', [
      { text: 'Vault', target: 'obsidian://open?vault=x', action: 'link', linkSyntax: 'markdown' },
    ]);
    const { nodes } = resolveEdges([solution], metadata);
    expect(nodes[0]!.resolvedLinks[0]?.location).toBe('protocol');
  });

  it('classifies relative path as internal', () => {
    const solution = makeBaseNode('My Solution', 'solution', [
      { text: 'Note', target: './other.md', action: 'link', linkSyntax: 'markdown' },
    ]);
    const { nodes } = resolveEdges([solution], metadata);
    expect(nodes[0]!.resolvedLinks[0]?.location).toBe('internal');
  });

  it('classifies wikilink with anchor to known node as node', () => {
    const goal = {
      label: 'vision.md',
      title: 'Vision',
      type: 'goal',
      schemaData: { title: 'Vision', type: 'goal' },
      linkTargets: ['Vision', 'vision#^section1'],
      contentLinks: [],
    };
    const solution = makeBaseNode('My Solution', 'solution', [
      {
        text: 'Vision',
        target: 'vision',
        anchor: '^section1',
        action: 'link' as const,
        linkSyntax: 'wikilink' as const,
      },
    ]);
    const { nodes } = resolveEdges([goal, solution], metadata);
    const sol = nodes.find((n) => n.title === 'My Solution')!;
    expect(sol.resolvedLinks[0]?.location).toBe('node');
  });

  it('nodes without contentLinks get empty resolvedLinks', () => {
    const goal = makeBaseNode('My Goal', 'goal');
    const { nodes } = resolveEdges([goal], metadata);
    expect(nodes[0]!.resolvedLinks).toEqual([]);
  });
});
