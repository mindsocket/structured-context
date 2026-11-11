import type { SemanticJudgeInput, SemanticJudgeResult, SemanticRuleSpec } from './types';

/** Escape a value for an XML attribute; element bodies stay raw, since the model reads them as text. */
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** System prompt: a strict judge that answers with one verdict from a closed set, as JSON. */
export function buildJudgeSystemPrompt(): string {
  return [
    'You are a strict, objective judge. You decide whether an item meets a rule.',
    'An item is one entry in a structured collection. It has a type, a title and fields, and it can sit under parent items.',
    'The user message holds the rule in <rule>, the item in <item>, any related items in <related_items>, and what each item type means in <item_types>.',
    'Choose the one verdict that best describes whether the item meets the rule.',
    '',
    'You must respond ONLY with a JSON object in this exact format:',
    '{',
    '  "verdict": "<exactly one of the allowed verdicts>",',
    '  "confidence": <number from 0 to 1>,',
    '  "evidence": "concise explanation citing specific quotes, phrases, or absent details from the item"',
    '}',
    '',
    'Guidelines:',
    '1. "verdict" must be one of the verdicts listed in <verdicts>, spelled exactly.',
    '2. "confidence" is how sure you are of the verdict.',
    '3. "evidence" must directly cite or quote relevant parts of the item, explaining the reasoning concisely.',
    '4. Do not include markdown code block formatting, intro text, or outro text. Respond only with the JSON object.',
  ].join('\n');
}

/** User prompt for one rule on one node, for the chat providers (Anthropic, OpenAI-compatible). Decision providers build their own request from the same input. */
export function buildJudgeUserPrompt(
  { node, related = [], schemaDescriptions }: Pick<SemanticJudgeInput, 'node' | 'related' | 'schemaDescriptions'>,
  rule: SemanticRuleSpec,
): string {
  const rubric = rule.rubric || rule.description;
  const lines: string[] = [
    `<rule id="${attr(rule.id)}" category="${attr(rule.category)}">`,
    `<rubric>${rubric}</rubric>`,
    '<verdicts>',
    ...Object.entries(rule.verdicts).map(
      ([name, description]) => `<verdict name="${attr(name)}">${description}</verdict>`,
    ),
    '</verdicts>',
    '</rule>',
    '',
    `<item id="${attr(node.id)}" type="${attr(node.resolvedType)}">`,
    `<title>${node.title}</title>`,
    ...(node.parentTitles.length > 0 ? [`<parents>${node.parentTitles.join(', ')}</parents>`] : []),
    "<fields>The item's fields as JSON. `content` is its body text.",
    JSON.stringify(node.schemaData, null, 2),
    '</fields>',
    '</item>',
  ];

  if (related.length > 0) {
    lines.push('', '<related_items>');
    for (const r of related) {
      lines.push(
        `<related_item relation="${attr(r.relations.join(', '))}" type="${attr(r.type)}">`,
        `<title>${r.title}</title>`,
        '<fields>',
        JSON.stringify(r.data, null, 2),
        '</fields>',
        '</related_item>',
      );
    }
    lines.push('</related_items>');
  }
  if (schemaDescriptions) {
    lines.push(
      '',
      '<item_types>What each type of item above is for, and what its fields mean, as JSON.',
      JSON.stringify(schemaDescriptions, null, 2),
      '</item_types>',
    );
  }
  lines.push('', 'Evaluate the item against the rule. Return only JSON with "verdict", "confidence" and "evidence".');
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
