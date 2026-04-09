import type { Expect, Test } from 'bun:test';
import type { ParseResult } from '../../src/plugins/util';

export const defineValidSpaceTests = (it: Test<[]>, expect: Expect) => (getResult: () => ParseResult) => {
  it('returns 12 OST nodes (5 original + vision_page + 2 embedded + solution_page + anchor_vision + 2 embedded)', () => {
    const result = getResult();
    expect(result.nodes).toHaveLength(12);
  });

  it('injects title from filename for file-based nodes', () => {
    const result = getResult();
    const vision = result.nodes.find((n) => n.label === 'Personal Vision.md');
    expect(vision?.schemaData.title).toBe('Personal Vision');
  });

  it('reports no-frontmatter.md as a warning with type no-type', () => {
    const result = getResult();
    const issue = result.parseIssues.find((i) => i.file === 'no-frontmatter.md');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(issue?.type).toBe('no-type');
    expect(issue?.message).toBe('No front-matter or type specified');
  });

  it('reports meeting-notes.md as a warning with type no-type', () => {
    const result = getResult();
    const issue = result.parseIssues.find((i) => i.file === 'meeting-notes.md');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(issue?.type).toBe('no-type');
  });

  it('skipped files do not appear in nodes', () => {
    const result = getResult();
    expect(result.nodes.every((n) => n.label !== 'no-frontmatter.md')).toBe(true);
  });

  it('nonSpace files do not appear in nodes', () => {
    const result = getResult();
    expect(result.nodes.every((n) => n.label !== 'meeting-notes.md')).toBe(true);
  });

  it('preserves numeric frontmatter fields on Technical Skills', () => {
    const result = getResult();
    const ts = result.nodes.find((n) => n.label === 'Technical Skills.md');
    expect(ts?.schemaData.impact).toBe(4);
    expect(ts?.schemaData.feasibility).toBe(3);
    expect(ts?.schemaData.resources).toBe(2);
    expect(ts?.schemaData.priority).toBe('p3');
  });

  it('Community OST.md (ost_on_a_page) is excluded from nodes', () => {
    const result = getResult();
    expect(result.nodes.every((n) => n.label !== 'Community OST.md')).toBe(true);
  });

  it('Community OST.md does not appear in parseIssues', () => {
    const result = getResult();
    expect(result.parseIssues.some((i) => i.file === 'Community OST.md')).toBe(false);
  });
};
