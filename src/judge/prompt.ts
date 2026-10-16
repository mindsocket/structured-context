import type { RelatedNode, SemanticJudgeInput, SemanticJudgeResult, SemanticRuleSpec } from './types';

function verdictList(rule: SemanticRuleSpec): string[] {
  return Object.entries(rule.verdicts).map(([name, description]) => `- "${name}": ${description}`);
}

/** System prompt: a strict judge that answers with one verdict from a closed set, as JSON. */
export function buildJudgeSystemPrompt(): string {
  return [
    'You are a strict, objective evaluation judge for structured planning and knowledge documents.',
    'Your task is to choose the one verdict that best describes whether a node satisfies a rule.',
    '',
    'You must respond ONLY with a JSON object in this exact format:',
    '{',
    '  "verdict": "<exactly one of the allowed verdicts>",',
    '  "confidence": <number from 0 to 1>,',
    '  "evidence": "concise explanation citing specific quotes, phrases, or absent details from the node"',
    '}',
    '',
    'Guidelines:',
    '1. "verdict" must be one of the allowed verdicts listed for the rule, spelled exactly.',
    '2. "confidence" is how sure you are of the verdict.',
    '3. "evidence" must directly cite or quote relevant parts of the node, explaining the reasoning concisely.',
    '4. Do not include markdown code block formatting, intro text, or outro text. Respond only with the JSON object.',
  ].join('\n');
}

/** User prompt for one rule on one node. */
export function buildJudgeUserPrompt(
  node: SemanticJudgeInput['node'],
  rule: SemanticRuleSpec,
  related: RelatedNode[] = [],
): string {
  const rubric = rule.rubric || rule.description;
  const lines: string[] = [
    '# Rule to Evaluate',
    `- ID: ${rule.id}`,
    `- Category: ${rule.category}`,
    `- Rubric: ${rubric}`,
    '',
    '## Allowed verdicts',
    ...verdictList(rule),
    '',
    '# Node Under Evaluation',
    `- File / Label: ${node.label}`,
    `- Title: ${node.title}`,
    `- Type: ${node.type} (resolved: ${node.resolvedType})`,
  ];

  if (node.resolvedParents && node.resolvedParents.length > 0) {
    lines.push(`- Parents: ${node.resolvedParents.map((p) => p.title).join(', ')}`);
  }

  lines.push('', '## Node Content & Frontmatter:', '```json', JSON.stringify(node.schemaData, null, 2), '```', '');
  if (related.length > 0) {
    lines.push('# Related Nodes', 'Each is listed with its relation to the node under evaluation.', '');
    for (const r of related) {
      lines.push(
        `## ${r.title}`,
        `- Relation: ${r.relations.join(', ')}`,
        `- Type: ${r.type}`,
        '```json',
        JSON.stringify(r.data, null, 2),
        '```',
        '',
      );
    }
  }
  lines.push('Evaluate this node against the rule. Return only JSON with "verdict", "confidence" and "evidence".');
  return lines.join('\n');
}

/**
 * Parse judge output into a verdict from the rule's allowed set.
 * Handles clean JSON, markdown-wrapped JSON, and a regex fallback for surrounding text.
 */
export function parseJudgeResponse(rawText: string, allowed: string[]): SemanticJudgeResult {
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  let verdict: string | undefined;
  let confidence: number | undefined;
  let evidence: string | undefined;

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.verdict === 'string') verdict = parsed.verdict.trim();
    if (typeof parsed.confidence === 'number') confidence = parsed.confidence;
    if (typeof parsed.evidence === 'string') evidence = parsed.evidence.trim();
  } catch {
    const verdictMatch = /"verdict"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(cleaned);
    const confidenceMatch = /"confidence"\s*:\s*([0-9.]+)/i.exec(cleaned);
    const evidenceMatch = /"evidence"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(cleaned);
    verdict = verdictMatch?.[1]?.trim();
    confidence = confidenceMatch ? Number(confidenceMatch[1]) : undefined;
    evidence = evidenceMatch?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
  }

  if (verdict === undefined || !allowed.includes(verdict)) {
    return {
      error: `Model provider returned ${verdict === undefined ? 'no verdict' : `unknown verdict "${verdict}"`} (allowed: ${allowed.join(', ')}): ${rawText.slice(0, 200)}`,
    };
  }
  return {
    verdict,
    ...(confidence !== undefined &&
      Number.isFinite(confidence) && { confidence: Math.min(1, Math.max(0, confidence)) }),
    ...(evidence && { evidence }),
  };
}
