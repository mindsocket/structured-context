import { describe, expect, it } from 'bun:test';
import { extractEmbeddedNodes } from '../../../src/plugins/markdown/parse-embedded';
import type { HierarchyLevel } from '../../../src/types';
import { makeLevel, withHierarchy } from '../../test-helpers';

const HIERARCHY: HierarchyLevel[] = [makeLevel('goal'), makeLevel('opportunity')];
const metadata = { ...withHierarchy(HIERARCHY) };

describe('extractEmbeddedNodes - headings below a horizontal rule', () => {
  it('ignores plain headings on a typed page without reporting them', () => {
    const body = `
Intro

---

## Notes

## References
`;
    const { nodes, terminatedHeadings } = extractEmbeddedNodes(body, {
      page: { id: 'note.md', targets: ['note'] },
      pageType: 'note',
      metadata,
    });
    expect(nodes).toHaveLength(0);
    expect(terminatedHeadings).toEqual([]);
  });

  it('reports headings on a typed page that would have become nodes', () => {
    const body = `## Before

---

## Plain

## Typed [type:: opportunity]

## opportunity
`;
    const { terminatedHeadings } = extractEmbeddedNodes(body, {
      page: { id: 'goal.md', targets: ['goal'] },
      pageType: 'goal',
      metadata,
      lineOffset: 3,
    });
    expect(terminatedHeadings).toEqual([
      { title: 'Typed', line: 10 },
      { title: 'opportunity', line: 12 },
    ]);
  });

  it('reports every heading in space on a page mode', () => {
    const body = `# Goal

---

# Archived

## Old
`;
    const { terminatedHeadings } = extractEmbeddedNodes(body, { pageType: 'space_on_a_page', metadata });
    expect(terminatedHeadings.map((h) => h.title)).toEqual(['Archived', 'Old']);
  });
});
