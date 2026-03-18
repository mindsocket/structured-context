import { describe, expect, it } from 'bun:test';
import { extractEmbeddedNodes } from '../../src/read/parse-embedded';
import { makeLevel, makeRelationship } from '../test-helpers';

describe('Embedded nodes with parent-side relationships', () => {
  it('should create child nodes when heading anchor matches relationship type', () => {
    const markdown = `# Some content

## Applications
### Project management using Zephyr ^Applications1
- [[Zephyr Tool]]
`;

    const result = extractEmbeddedNodes(markdown, {
      pageTitle: 'Test Solution',
      pageType: 'Solutions',
      metadata: {
        hierarchy: { levels: ['Phases', 'Activities', 'Capabilities', 'Tools'].map((t) => makeLevel(t)) },
        relationships: [
          makeRelationship('Solutions', 'Applications', {
            field: 'applications',
            fieldOn: 'parent',
            multiple: true,
            matchers: ['Applications'],
          }),
        ],
      },
    });

    // Should have 1 Applications node
    const appNode = result.nodes.find((n) => n.resolvedType === 'Applications');

    expect(appNode).toBeDefined();
    expect(appNode?.schemaData.title).toBe('Project management using Zephyr');
    expect(appNode?.schemaData.type).toBe('Applications');
  });
});
