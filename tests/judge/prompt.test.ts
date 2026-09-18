import { describe, expect, it } from 'bun:test';
import { buildJudgeSystemPrompt, buildJudgeUserPrompt, parseJudgeResponse } from '../../src/judge/prompt';
import { graded, node, passFailRule } from './helpers';

describe('judge prompt and response parser', () => {
  it('system prompt asks for a JSON verdict, confidence and evidence', () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"evidence"');
  });

  it('user prompt lists the rule, its allowed verdicts and the node', () => {
    const prompt = buildJudgeUserPrompt(node, graded);
    expect(prompt).toContain('framing');
    expect(prompt).toContain('"weak": Vague need');
    expect(prompt).toContain('"solution": A solution in disguise');
    expect(prompt).toContain('I cannot find my receipts');
    expect(prompt).toContain('Faster Tax Filing');
    expect(prompt).toContain('User interview with Alice');
  });

  it('user prompt prefers the rubric over the description', () => {
    expect(buildJudgeUserPrompt(node, passFailRule)).toContain('Needs to sound like a customer quote');
    expect(buildJudgeUserPrompt(node, graded)).toContain('Rubric: Framing quality');
  });

  const allowed = ['pass', 'fail'];

  it('parses clean JSON', () => {
    expect(parseJudgeResponse('{"verdict":"pass","confidence":0.9,"evidence":"clear"}', allowed)).toEqual({
      verdict: 'pass',
      confidence: 0.9,
      evidence: 'clear',
    });
  });

  it('parses fenced JSON and clamps confidence', () => {
    const raw = '```json\n{"verdict":"fail","confidence":4,"evidence":"solution"}\n```';
    expect(parseJudgeResponse(raw, allowed)).toEqual({ verdict: 'fail', confidence: 1, evidence: 'solution' });
  });

  it('allows confidence and evidence to be absent', () => {
    expect(parseJudgeResponse('{"verdict":"pass"}', allowed)).toEqual({ verdict: 'pass' });
  });

  it('extracts fields from text surrounding malformed JSON', () => {
    const raw = 'Sure! Here you go: {"verdict": "fail", "confidence": 0.4, "evidence": "says \\"build X\\"" trailing';
    const result = parseJudgeResponse(raw, allowed);
    expect(result).toMatchObject({ verdict: 'fail', confidence: 0.4 });
  });

  it('returns an error for a verdict outside the allowed set', () => {
    const result = parseJudgeResponse('{"verdict":"maybe"}', allowed);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('unknown verdict "maybe"');
  });

  it('returns an error when nothing parseable is present', () => {
    expect(parseJudgeResponse('I cannot decide', allowed)).toHaveProperty('error');
  });
});
