import { describe, expect, it } from 'bun:test';
import { extractEmbeddedNodes } from '../../../src/plugins/markdown/parse-embedded';
import type { HierarchyLevel } from '../../../src/types';
import { makeLevel, withHierarchy } from '../../test-helpers';

const HIERARCHY: HierarchyLevel[] = [makeLevel('goal'), makeLevel('task', { templateFormat: 'list' })];
const metadata = withHierarchy(HIERARCHY);

describe('extractEmbeddedNodes - content is markdown source', () => {
  it('keeps inline formatting, blocks and fences of a page preamble verbatim', () => {
    const body = `Some **bold** text with a [link](https://example.com).

- item one
- item two

\`\`\`ts
const x = 1;
\`\`\`
`;
    const { preambleContent } = extractEmbeddedNodes(body, { pageTitle: 'Page', pageType: 'goal', metadata });
    expect(preambleContent).toBe(
      'Some **bold** text with a [link](https://example.com).\n\n- item one\n- item two\n\n```ts\nconst x = 1;\n```',
    );
  });

  it('includes untyped headings in the enclosing node content', () => {
    const body = `Intro.

# Computation

    SELECT 1

## Detail

More.
`;
    const { preambleContent } = extractEmbeddedNodes(body, { pageTitle: 'Page', pageType: 'goal', metadata });
    expect(preambleContent).toBe('Intro.\n\n# Computation\n\n    SELECT 1\n\n## Detail\n\nMore.');
  });

  it('gives an embedded node the source under its heading, excluding nested embedded nodes', () => {
    const body = `# Parent [type:: goal]

Parent *text*.

## Child [type:: goal]

Child text with \`code\`.

- [type:: task] Do it
- plain item
`;
    const { nodes } = extractEmbeddedNodes(body, { pageTitle: 'Page', pageType: 'goal', metadata });
    expect(nodes.find((n) => n.title === 'Parent')?.content).toBe('Parent *text*.');
    expect(nodes.find((n) => n.title === 'Child')?.content).toBe('Child text with `code`.\n\n- plain item');
    expect(nodes.find((n) => n.title === 'Do it')?.content).toBeUndefined();
  });

  it('returns an untyped heading to the enclosing node once the embedded section ends', () => {
    const body = `# Child [type:: goal]

Child text.

# Notes

Page level notes.
`;
    const { nodes, preambleContent } = extractEmbeddedNodes(body, { pageTitle: 'Page', pageType: 'goal', metadata });
    expect(nodes.find((n) => n.title === 'Child')?.content).toBe('Child text.');
    expect(preambleContent).toBe('# Notes\n\nPage level notes.');
  });

  it('gives a list item node the markdown under it, excluding nested embedded items', () => {
    const body = `# Goal [type:: goal]

### task

- Write **docs**

  Extra detail for the task.

  - Sub task
`;
    const { nodes } = extractEmbeddedNodes(body, { pageTitle: 'Page', pageType: 'goal', metadata });
    const task = nodes.find((n) => n.title === 'Write **docs**'.replace(/\*/g, ''));
    expect(task?.content).toBe('Extra detail for the task.');
    expect(nodes.find((n) => n.title === 'Sub task')).toBeDefined();
  });
});
