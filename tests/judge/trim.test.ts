import { describe, expect, it } from 'bun:test';
import { cutBody, estimateTokens, type NodeInput, trimMarker, trimToCap } from '../../src/judge/trim';
import { node } from './helpers';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const input = (nodeBody: string | undefined, relatedBodies: string[]): NodeInput => ({
  node: { ...node, schemaData: { ...node.schemaData, ...(nodeBody !== undefined && { content: nodeBody }) } },
  related: relatedBodies.map((content, i) => ({
    relations: ['child'],
    title: `Related ${i}`,
    type: 'solution',
    data: { owner: 'team', content },
  })),
});
const relatedBody = (r: NodeInput, i: number) => r.related?.[i]?.data.content as string;

describe('cutBody', () => {
  it('leaves a body within the limit whole', () => {
    expect(cutBody('one two', 7)).toBe('one two');
  });

  it('ends at the last whitespace before the limit and counts the characters removed', () => {
    const out = cutBody('alpha beta gamma', 12);
    expect(out).toBe(`alpha beta ${trimMarker(6)}`);
  });

  it('keeps a word that ends exactly at the limit', () => {
    expect(cutBody('alpha beta gamma', 10)).toBe(`alpha beta ${trimMarker(6)}`);
  });

  it('leaves just the marker when nothing is kept', () => {
    expect(cutBody('alpha beta', 0)).toBe(trimMarker(10));
    expect(cutBody('alphabeta', 4)).toBe(trimMarker(9));
  });
});

describe('trimToCap', () => {
  it('does nothing under the cap', () => {
    const i = input('body', ['rel']);
    expect(trimToCap(i, 10_000)).toEqual({ input: i, trimmed: false, overCap: false });
  });

  it('cuts the longest related bodies to one ceiling and keeps shorter ones whole', () => {
    const short = words(10);
    const i = input('own', [words(2000), short, words(1500)]);
    const cap = Math.ceil(estimateTokens(i) / 2);
    const out = trimToCap(i, cap);
    expect(out.trimmed).toBe(true);
    expect(out.overCap).toBe(false);
    expect(estimateTokens(out.input)).toBeLessThanOrEqual(cap);
    expect(relatedBody(out.input, 1)).toBe(short);
    expect(relatedBody(out.input, 0)).toContain('[RULE_EVALUATION_CONTENT_TRIMMED');
    expect(relatedBody(out.input, 2)).toContain('[RULE_EVALUATION_CONTENT_TRIMMED');
    expect(out.input.node.schemaData.content).toBe('own');
    expect(out.input.related).toHaveLength(3);
  });

  it('cuts the evaluated node body only once related bodies are exhausted', () => {
    const own = words(3000);
    const i = input(own, [words(50)]);
    const withoutBodies = estimateTokens(input('', ['']));
    const out = trimToCap(i, withoutBodies + 200);
    expect(out.overCap).toBe(false);
    expect(relatedBody(out.input, 0)).toBe(trimMarker(words(50).length));
    expect(String(out.input.node.schemaData.content)).toContain('[RULE_EVALUATION_CONTENT_TRIMMED');
    expect(String(out.input.node.schemaData.content).length).toBeLessThan(own.length);
  });

  it('never cuts fields or drops nodes, and reports an input that still does not fit', () => {
    const i = input(words(100), [words(100)]);
    const out = trimToCap(i, 10);
    expect(out.overCap).toBe(true);
    expect(out.input.related).toHaveLength(1);
    expect(out.input.related?.[0]?.data.owner).toBe('team');
    expect(out.input.node.schemaData.source).toBe(node.schemaData.source);
  });

  it('does not mutate its input', () => {
    const i = input(words(100), [words(1000)]);
    const before = JSON.stringify(i);
    trimToCap(i, 500);
    expect(JSON.stringify(i)).toBe(before);
  });
});
