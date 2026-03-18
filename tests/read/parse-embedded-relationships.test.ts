import { describe, expect, it } from 'bun:test';
import { extractEmbeddedNodes } from '../../src/read/parse-embedded';
import type { Relationship } from '../../src/types';
import { makeLevel } from '../test-helpers';

describe('extractEmbeddedNodes - relationships', () => {
  const hierarchy = ['vision', 'mission', 'goal', 'opportunity', 'solution', 'experiment'];

  it('extracts table rows as typed nodes when first col matches relation type', () => {
    const relationships: Relationship[] = [
      {
        parent: 'opportunity',
        type: 'assumption',
        field: 'parent',
        fieldOn: 'child',
        templateFormat: 'table',
        matchers: ['Assumptions'],
        embeddedTemplateFields: ['assumption', 'status'],
        multiple: true,
      },
    ];

    const body = `
# My Big Opportunity [type:: opportunity]

### Assumptions

| assumption | status | confidence |
|---|---|---|
| We can build this | active | medium |
| Users want this | identified | low |
`;

    const { nodes } = extractEmbeddedNodes(body, {
      pageType: 'opportunity',
      metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
    });

    const opp = nodes.find((n) => n.schemaData.type === 'opportunity');
    expect(opp).toBeDefined();

    const assumptions = nodes.filter((n) => n.schemaData.type === 'assumption');
    expect(assumptions).toHaveLength(2);
    expect(assumptions[0]?.schemaData.title).toBe('We can build this');
    expect(assumptions[0]?.schemaData.status).toBe('active');
    expect(assumptions[0]?.schemaData.confidence).toBe('medium');
    expect(assumptions[0]?.schemaData.parent).toBe('[[My Big Opportunity]]');
  });

  it('infers row types from the first column if no relationship explicitly matches the heading (untyped table)', () => {
    const body = `
# My Big Opportunity [type:: opportunity]

| assumption | status |
|---|---|
| They will buy it | identified |
`;
    const { nodes } = extractEmbeddedNodes(body, {
      pageType: 'opportunity',
      metadata: { hierarchy: { levels: [...hierarchy, 'assumption'].map((t) => makeLevel(t)) }, relationships: [] },
    });

    const assumptions = nodes.filter((n) => n.schemaData.type === 'assumption');
    expect(assumptions).toHaveLength(1);
    expect(assumptions[0]?.schemaData.title).toBe('They will buy it');
  });

  it('translates explicit heading matchers to typed parent context nodes', () => {
    const relationships: Relationship[] = [
      {
        parent: 'opportunity',
        type: 'problem_statement',
        field: 'parent',
        fieldOn: 'child',
        templateFormat: 'heading',
        matchers: ['What problem are we solving?'],
        multiple: false,
      },
    ];

    const body = `
# Opportunity 1 [type:: opportunity]

### What problem are we solving?
Our users are sad.
`;
    const { nodes } = extractEmbeddedNodes(body, {
      pageType: 'opportunity',
      metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
    });

    const probNodes = nodes.filter((n) => n.schemaData.type === 'problem_statement');
    expect(probNodes).toHaveLength(1);
    expect(probNodes[0]?.schemaData.title).toBe('What problem are we solving?');
    expect(probNodes[0]?.schemaData.content).toContain('Our users are sad.');
    expect(probNodes[0]?.schemaData.parent).toBe('[[Opportunity 1]]');
  });

  it('supports list-based sub-entities after relationship heading', () => {
    const relationships: Relationship[] = [
      {
        parent: 'opportunity',
        type: 'solution',
        field: 'parent',
        fieldOn: 'child',
        templateFormat: 'list',
        matchers: ['Possible Solutions'],
        multiple: true,
      },
    ];

    const body = `
# Multi Mode [type:: opportunity]

### Possible Solutions
- Build a web app
- Build a mobile app
`;
    const { nodes } = extractEmbeddedNodes(body, {
      pageType: 'opportunity',
      metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
    });

    const solutions = nodes.filter((n) => n.schemaData.type === 'solution');
    expect(solutions).toHaveLength(2);
    expect(solutions[0]?.schemaData.title).toBe('Build a web app');
    expect(solutions[1]?.schemaData.title).toBe('Build a mobile app');
    expect(solutions[0]?.schemaData.parent).toBe('[[Multi Mode]]');
  });

  it('supports /regex/ syntax and case-insensitive matching', () => {
    const relationships: Relationship[] = [
      {
        parent: 'opportunity',
        type: 'assumption',
        field: 'parent',
        fieldOn: 'child',
        templateFormat: 'table',
        matchers: ['/assum.*/'],
        embeddedTemplateFields: ['assumption', 'status'],
        multiple: true,
      },
    ];

    const body = `
# Case Sensitivity [type:: opportunity]

### assuMPTIONS

| assumption | status |
|---|---|
| Match me | active |
`;

    const { nodes } = extractEmbeddedNodes(body, {
      pageType: 'opportunity',
      metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
    });

    const assumptions = nodes.filter((n) => n.schemaData.type === 'assumption');
    expect(assumptions).toHaveLength(1);
    expect(assumptions[0]?.schemaData.title).toBe('Match me');
  });

  it('supports case-insensitive implicit type match', () => {
    const relationships: Relationship[] = [
      {
        parent: 'opportunity',
        type: 'assumption',
        field: 'parent',
        fieldOn: 'child',
        templateFormat: 'table',
        matchers: [],
        embeddedTemplateFields: ['assumption', 'status'],
        multiple: true,
      },
    ];

    const body = `
# Implicit Match [type:: opportunity]

### ASSUMPTION

| assumption | status |
|---|---|
| Implicit Match | active |
`;

    const { nodes } = extractEmbeddedNodes(body, {
      pageType: 'opportunity',
      metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
    });

    const assumptions = nodes.filter((n) => n.schemaData.type === 'assumption');
    expect(assumptions).toHaveLength(1);
    expect(assumptions[0]?.schemaData.title).toBe('Implicit Match');
  });

  describe('fieldOn: parent array mutation bug', () => {
    it('should throw error when parent field is not an array (list format)', () => {
      const relationships: Relationship[] = [
        {
          parent: 'opportunity',
          type: 'solution',
          templateFormat: 'list',
          matchers: ['Possible Solutions'],
          multiple: true,
          field: 'solutions',
          fieldOn: 'parent',
        },
      ];

      const body = `
# My Opportunity [type:: opportunity] [solutions:: "string value"]

### Possible Solutions
- Solution A
- Solution B
`;

      expect(() =>
        extractEmbeddedNodes(body, {
          pageType: 'opportunity',
          metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
        }),
      ).toThrow(/Cannot append child link to field 'solutions'.*field exists but is not an array/);
    });

    it('should throw error when parent field is not an array (table format)', () => {
      const relationships: Relationship[] = [
        {
          parent: 'opportunity',
          type: 'assumption',
          templateFormat: 'table',
          matchers: ['Assumptions'],
          multiple: true,
          field: 'assumptions',
          fieldOn: 'parent',
          embeddedTemplateFields: ['assumption', 'status'],
        },
      ];

      const body = `
# My Opportunity [type:: opportunity] [assumptions:: "string value"]

### Assumptions

| assumption | status |
|---|---|
| Assumption One | active |
| Assumption Two | identified |
`;

      expect(() =>
        extractEmbeddedNodes(body, {
          pageType: 'opportunity',
          metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
        }),
      ).toThrow(/Cannot append child link to field 'assumptions'.*field exists but is not an array/);
    });

    it('should throw error when parent field is a number', () => {
      const relationships: Relationship[] = [
        {
          parent: 'opportunity',
          type: 'solution',
          templateFormat: 'list',
          matchers: ['Solutions'],
          multiple: true,
          field: 'count',
          fieldOn: 'parent',
        },
      ];

      const body = `
# My Opportunity [type:: opportunity] [count:: 42]

### Solutions
- Solution A
- Solution B
`;

      expect(() =>
        extractEmbeddedNodes(body, {
          pageType: 'opportunity',
          metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
        }),
      ).toThrow(/Cannot append child link to field 'count'.*field exists but is not an array/);
    });

    it('should append to existing parent array field (list format)', () => {
      const relationships: Relationship[] = [
        {
          parent: 'opportunity',
          type: 'solution',
          templateFormat: 'list',
          matchers: ['Solutions'],
          multiple: true,
          field: 'solutions',
          fieldOn: 'parent',
        },
      ];

      const body = `
# My Opportunity [type:: opportunity]

### Solutions
- Solution A
- Solution B
- Solution C
`;

      const { nodes } = extractEmbeddedNodes(body, {
        pageType: 'opportunity',
        metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
      });

      const opportunity = nodes.find((n) => n.schemaData.type === 'opportunity');
      expect(opportunity).toBeDefined();

      // When field doesn't exist, a new array is created
      const solutionsField = opportunity?.schemaData.solutions;
      expect(solutionsField).toEqual(['[[Solution A]]', '[[Solution B]]', '[[Solution C]]']);
    });

    it('should append to existing parent array field (table format)', () => {
      const relationships: Relationship[] = [
        {
          parent: 'opportunity',
          type: 'assumption',
          templateFormat: 'table',
          matchers: ['Assumptions'],
          multiple: true,
          field: 'assumptions',
          fieldOn: 'parent',
          embeddedTemplateFields: ['assumption', 'status'],
        },
      ];

      const body = `
# My Opportunity [type:: opportunity]

### Assumptions

| assumption | status |
|---|---|
| Assumption One | active |
| Assumption Two | identified |
`;

      const { nodes } = extractEmbeddedNodes(body, {
        pageType: 'opportunity',
        metadata: { hierarchy: { levels: hierarchy.map((t) => makeLevel(t)) }, relationships },
      });

      const opportunity = nodes.find((n) => n.schemaData.type === 'opportunity');
      expect(opportunity).toBeDefined();

      // When field doesn't exist, a new array is created
      const assumptionsField = opportunity?.schemaData.assumptions;
      expect(assumptionsField).toEqual(['[[Assumption One]]', '[[Assumption Two]]']);
    });
  });
});
