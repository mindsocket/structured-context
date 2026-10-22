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
    const { preambleContent } = extractEmbeddedNodes(body, {
      page: { id: 'Page.md', targets: ['Page'] },
      pageType: 'goal',
      metadata,
    });
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
    const { preambleContent } = extractEmbeddedNodes(body, {
      page: { id: 'Page.md', targets: ['Page'] },
      pageType: 'goal',
      metadata,
    });
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
    const { nodes } = extractEmbeddedNodes(body, {
      page: { id: 'Page.md', targets: ['Page'] },
      pageType: 'goal',
      metadata,
    });
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
    const { nodes, preambleContent } = extractEmbeddedNodes(body, {
      page: { id: 'Page.md', targets: ['Page'] },
      pageType: 'goal',
      metadata,
    });
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
    const { nodes } = extractEmbeddedNodes(body, {
      page: { id: 'Page.md', targets: ['Page'] },
      pageType: 'goal',
      metadata,
    });
    const task = nodes.find((n) => n.title === 'Write **docs**'.replace(/\*/g, ''));
    expect(task?.content).toBe('Extra detail for the task.');
    expect(nodes.find((n) => n.title === 'Sub task')).toBeDefined();
  });
});

describe('extractEmbeddedNodes - list item content is dedented', () => {
  const task = (items: string) => `# Goal [type:: goal]\n\n### task\n\n${items}`;
  const run = (body: string) =>
    extractEmbeddedNodes(body, { page: { id: 'Page.md', targets: ['Page'] }, pageType: 'goal', metadata });
  const contentOf = (body: string) => run(body).nodes.find((n) => n.title === 'Write docs')?.content;

  it('dedents a continuation paragraph by the item content indent', () => {
    expect(contentOf(task('- Write docs\n\n  First para.\n\n  Second para.\n'))).toBe(
      'First para.\n\n  Second para.'.replace('  ', ''),
    );
  });

  it('dedents by the content column of an ordered item', () => {
    expect(contentOf(task('10. Write docs\n\n    Detail.\n'))).toBe('Detail.');
  });

  it('keeps relative indent for a nested plain sub-list', () => {
    expect(
      contentOf('# Goal [type:: goal]\n\n- Write docs [type:: task]\n\n  Detail.\n\n  - plain one\n    - plain two\n'),
    ).toBe('Detail.\n\n- plain one\n  - plain two');
  });

  it('dedents a fenced code block and keeps extra indent inside it', () => {
    expect(contentOf(task('- Write docs\n\n  ```js\n  if (x) {\n    y();\n  }\n  ```\n'))).toBe(
      '```js\nif (x) {\n  y();\n}\n```',
    );
  });

  it('preserves CRLF line endings', () => {
    expect(contentOf(task('- Write docs\r\n\r\n  Line one.\r\n\r\n    indented\r\n'))).toBe(
      'Line one.\r\n\r\n  indented',
    );
  });

  it('leaves heading content unchanged', () => {
    const body = '# Goal [type:: goal]\n\n## Child [type:: task]\n\n  Indented text.\n';
    expect(run(body).nodes.find((n) => n.title === 'Child')?.content).toBe('  Indented text.');
  });
});

const extract = (body: string) =>
  extractEmbeddedNodes(body, { page: { id: 'Page.md', targets: ['Page'] }, pageType: 'goal', metadata });
const contentOf = (body: string, title: string) => extract(body).nodes.find((n) => n.title === title)?.content;

describe('extractEmbeddedNodes - content is contiguous source', () => {
  it('keeps a loose list loose', () => {
    expect(extract('- a\n\n- b\n\n- c\n').preambleContent).toBe('- a\n\n- b\n\n- c');
  });

  it('keeps two separate lists separate, with their original blank lines', () => {
    expect(extract('- a\n\n\n- b\n\ntext\n\n* c').preambleContent).toBe('- a\n\n\n- b\n\ntext\n\n* c');
  });

  it('keeps CRLF line endings', () => {
    const body = 'Para one\r\nline two\r\n\r\n# Computation\r\n\r\n    SELECT 1\r\n';
    expect(extract(body).preambleContent).toBe('Para one\r\nline two\r\n\r\n# Computation\r\n\r\n    SELECT 1');
  });

  it('keeps code fences, including headings inside them, verbatim', () => {
    const body = '```python\n# Computation\nx = 1\n\n\ny = 2\n```\n\nAfter.\n';
    expect(extract(body).preambleContent).toBe('```python\n# Computation\nx = 1\n\n\ny = 2\n```\n\nAfter.');
  });

  it('keeps trailing whitespace inside the content and trims it from the end', () => {
    expect(extract('line with trailing  \nnext\t\n\n   \n').preambleContent).toBe('line with trailing  \nnext');
  });

  it('gives a node with an empty body no content', () => {
    const { nodes } = extract('# Child [type:: goal]\n\n# Other [type:: goal]\n\n   \n');
    expect(nodes.map((n) => n.content)).toEqual([undefined, undefined]);
    expect(extract('').preambleContent).toBeUndefined();
  });

  it('keeps blank lines either side of a nested embedded node', () => {
    const body = 'Before.\n\n- [type:: task] Do it\n\nAfter.\n';
    expect(extract(body).preambleContent).toBe('Before.\n\nAfter.');
  });

  it('joins the pieces around a nested embedded list item from the original text', () => {
    const body = '- plain one\n- [type:: task] Do it\n- plain two\n';
    expect(extract(body).preambleContent).toBe('- plain one\n- plain two');
  });

  it('keeps a plain list item with a nested typed sub-item whole, as the sub-item is not embedded', () => {
    const body = '# Child [type:: goal]\n\n- plain\n  - sub [type:: task] T\n';
    const { nodes } = extract(body);
    expect(nodes.map((n) => n.title)).toEqual(['Child']);
    expect(nodes[0]?.content).toBe('- plain\n  - sub [type:: task] T');
  });
});

describe('extractEmbeddedNodes - inline field lines', () => {
  it('strips field-only lines and paragraphs from content', () => {
    const body = `# Child [type:: goal]

owner:: alice

[priority:: high]

Prose line.
effort:: 3
More prose.
`;
    const child = extract(body).nodes[0];
    expect(child?.content).toBe('Prose line.\nMore prose.');
    expect(child?.schemaData).toMatchObject({ owner: 'alice', priority: 'high', effort: '3' });
  });

  it('strips a last field line that has no terminator, with CRLF', () => {
    const child = extract('# Child [type:: goal]\r\n\r\nProse.\r\nowner:: bob').nodes[0];
    expect(child?.content).toBe('Prose.');
    expect(child?.schemaData.owner).toBe('bob');
  });

  it('keeps a field written mid-sentence as part of the prose', () => {
    const child = extract('# Child [type:: goal]\n\nSet the [priority:: high] flag before launch.\n').nodes[0];
    expect(child?.content).toBe('Set the [priority:: high] flag before launch.');
    expect(child?.schemaData.priority).toBe('high');
  });

  it('keeps blank lines either side of a stripped field paragraph and a YAML block', () => {
    const body = '# Child [type:: goal]\n\nA.\n\nowner:: x\n\n```yaml\nsize: 3\n```\n\nB.\n';
    expect(extract(body).nodes[0]?.content).toBe('A.\n\nB.');
  });
});

describe('extractEmbeddedNodes - untyped headings and section ownership', () => {
  const body = (untyped: string) => `# Parent [type:: goal]

Parent text.

## Child [type:: goal]

Child text.

${untyped}

Under untyped.
owner:: bob
`;

  it('ends the section of an embedded node at an untyped heading of the same level', () => {
    const { nodes } = extract(body('## Notes'));
    expect(nodes.find((n) => n.title === 'Child')?.content).toBe('Child text.');
    expect(nodes.find((n) => n.title === 'Child')?.schemaData.owner).toBeUndefined();
    const parent = nodes.find((n) => n.title === 'Parent');
    expect(parent?.content).toBe('Parent text.\n\n## Notes\n\nUnder untyped.');
    expect(parent?.schemaData.owner).toBe('bob');
  });

  it('ends the section of an embedded node at an untyped heading of a higher level', () => {
    const { nodes, preambleContent } = extract(body('# Notes'));
    expect(nodes.find((n) => n.title === 'Child')?.content).toBe('Child text.');
    expect(nodes.find((n) => n.title === 'Parent')?.content).toBe('Parent text.');
    expect(preambleContent).toBe('# Notes\n\nUnder untyped.');
    expect(extract(body('# Notes')).nodes.find((n) => n.schemaData.owner)).toBeUndefined();
  });

  it('keeps an untyped deeper heading inside the embedded node section', () => {
    const { nodes } = extract(body('### Notes'));
    const child = nodes.find((n) => n.title === 'Child');
    expect(child?.content).toBe('Child text.\n\n### Notes\n\nUnder untyped.');
    expect(child?.schemaData.owner).toBe('bob');
    expect(nodes.find((n) => n.title === 'Parent')?.content).toBe('Parent text.');
  });

  it('keeps a heading deeper than the supported depth in the section content', () => {
    expect(contentOf('# Child [type:: goal]\n\nText.\n\n###### Deep\n\nMore.\n', 'Child')).toBe(
      'Text.\n\n###### Deep\n\nMore.',
    );
  });
});
