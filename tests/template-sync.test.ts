import { describe, expect, it } from 'bun:test';
import type { AnySchemaObject } from 'ajv';
import type { TypeVariant } from '../src/commands/template-sync';
import { generateNewContent } from '../src/commands/template-sync';
import type { Relationship, SchemaWithMetadata } from '../src/types';

describe('template-sync - generateNewContent', () => {
  const schema: SchemaWithMetadata = {
    title: 'Test Schema',
    oneOf: [],
  };

  const opportunityRelationships: Relationship[] = [
    {
      parent: 'opportunity',
      type: 'assumption',
      field: 'parent',
      fieldOn: 'child',
      multiple: true,
      templateFormat: 'table',
      matchers: ['Assumptions'],
      embeddedTemplateFields: ['assumption', 'status'],
    },
    {
      parent: 'opportunity',
      type: 'problem_statement',
      field: 'parent',
      fieldOn: 'child',
      multiple: false,
      templateFormat: 'heading',
      matchers: ['What problem are we solving?'],
    },
    {
      parent: 'opportunity',
      type: 'solution',
      field: 'parent',
      fieldOn: 'child',
      multiple: true,
      templateFormat: 'list',
      matchers: ['Solutions'],
    },
  ];

  const variant: TypeVariant = {
    required: [],
    optional: ['status'],
    properties: {
      status: { type: 'string', enum: ['active', 'closed'] },
    },
    example: { type: 'opportunity' },
    description: 'An opportunity',
    relationships: opportunityRelationships,
    hierarchyChildren: [],
  };

  const assumptionVariant: TypeVariant = {
    required: ['assumption'],
    optional: ['status'],
    properties: { assumption: { type: 'string' }, status: { type: 'string' } },
    example: { type: 'assumption', assumption: 'User will pay', status: 'high' },
    description: 'An assumption',
    relationships: [],
    hierarchyChildren: [],
  };

  const allVariants = new Map<string, TypeVariant>([
    ['opportunity', variant],
    ['assumption', assumptionVariant],
  ]);

  const registry = new Map<string, AnySchemaObject>();

  it('generates relationship stubs for new templates with examples', () => {
    const content = generateNewContent('opportunity', variant, schema, registry, allVariants, '');

    expect(content).toContain('### Assumptions');
    expect(content).toContain('| assumption | status |');
    expect(content).toContain('| User will pay | high |'); // from assumptionVariant example
    expect(content).toContain('### What problem are we solving?');
    expect(content).toContain('### Solutions');
    expect(content).toContain('- [type:: solution] TODO');
  });

  it('is idempotent and does not duplicate stubs', () => {
    const existingBody = '\n### Assumptions\n\n| assumption | status |\n| ---|---|\n| existing | active |\n';
    const content = generateNewContent('opportunity', variant, schema, registry, allVariants, existingBody);

    const assumptionMatches = content.match(/### Assumptions/g);
    expect(assumptionMatches).toHaveLength(1);
    expect(content).toContain('### What problem are we solving?'); // Still adds the ones that are missing
  });
});
