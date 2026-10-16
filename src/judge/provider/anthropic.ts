import { buildJudgeSystemPrompt, buildJudgeUserPrompt, parseJudgeResponse } from '../prompt';
import type {
  HydratedProvider,
  RelatedNode,
  SemanticJudgeInput,
  SemanticJudgeResult,
  SemanticRuleSpec,
} from '../types';
import { PerRuleJudgeProvider } from './per-rule';

export interface AnthropicJudgeProviderOptions extends HydratedProvider {
  /** The factory requires a resolved key before constructing a non-OpenAI provider. */
  apiKey?: string;
}

export const RECOMMENDED_ANTHROPIC_MODEL = 'claude-haiku-5-5';
export const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** Judge provider for the Anthropic Messages API. Reads no environment: it takes hydrated values. */
export class AnthropicJudgeProvider extends PerRuleJudgeProvider {
  readonly name = 'anthropic';
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(options: AnthropicJudgeProviderOptions) {
    super();
    this.apiKey = options.apiKey ?? '';
    this.model = options.model || RECOMMENDED_ANTHROPIC_MODEL;
    this.endpoint = options.endpoint || ANTHROPIC_MESSAGES_ENDPOINT;
  }

  protected async judgeRule(
    node: SemanticJudgeInput['node'],
    rule: SemanticRuleSpec,
    related: RelatedNode[],
  ): Promise<SemanticJudgeResult> {
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
        messages: [{ role: 'user', content: buildJudgeUserPrompt(node, rule, related) }],
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
