import { describe, expect, it } from 'bun:test';
import { extractEmbeddedNodes } from '../../src/read/parse-embedded';
import type { HierarchyLevel } from '../../src/types';

function toHierarchyLevels(types: string[]): HierarchyLevel[] {
  return types.map((type) => ({ type, field: 'parent', fieldOn: 'child', multiple: false, selfRef: false }));
}

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
        hierarchy: { levels: toHierarchyLevels(['Phases', 'Activities', 'Capabilities', 'Tools']) },
        relationships: [
          {
            parent: 'Solutions',
            type: 'Applications',
            field: 'applications',
            fieldOn: 'parent',
            matchers: ['Applications'],
            multiple: true,
          },
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
