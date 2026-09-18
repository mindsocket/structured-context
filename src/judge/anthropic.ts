import { PerRuleJudgeProvider } from './per-rule';
import { buildJudgeSystemPrompt, buildJudgeUserPrompt, parseJudgeResponse } from './prompt';
import type { SemanticJudgeInput, SemanticJudgeResult, SemanticRuleSpec } from './types';

export interface AnthropicJudgeProviderOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export const DEFAULT_ANTHROPIC_JUDGE_MODEL = 'claude-haiku-5-5';

/** Built-in judge provider for the Anthropic Messages API. */
export class AnthropicJudgeProvider extends PerRuleJudgeProvider {
  readonly name = 'anthropic';
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(options: AnthropicJudgeProviderOptions) {
    super();
    this.apiKey = options.apiKey;
    this.model = options.model || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_JUDGE_MODEL;
    this.endpoint = options.endpoint || 'https://api.anthropic.com/v1/messages';
  }

  protected async judgeRule(node: SemanticJudgeInput['node'], rule: SemanticRuleSpec): Promise<SemanticJudgeResult> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: buildJudgeSystemPrompt(),
        messages: [{ role: 'user', content: buildJudgeUserPrompt(node, rule) }],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Anthropic API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) {
      throw new Error('Anthropic API returned empty or missing text block in response.');
    }
    return parseJudgeResponse(text, Object.keys(rule.verdicts));
  }
}
