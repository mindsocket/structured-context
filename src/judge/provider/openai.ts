import { buildJudgeSystemPrompt, buildJudgeUserPrompt, parseJudgeResponse } from '../prompt';
import type { SemanticJudgeInput, SemanticJudgeResult, SemanticRuleSpec } from '../types';
import { PerRuleJudgeProvider } from './per-rule';

export interface OpenAIJudgeProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

/**
 * Built-in judge provider for OpenAI-compatible Chat Completions API.
 * Supports OpenAI, Ollama, vLLM, Groq, OpenRouter, and other compatible endpoints.
 */
export class OpenAIJudgeProvider extends PerRuleJudgeProvider {
  readonly name = 'openai';
  private apiKey?: string;
  private model: string;
  private endpoint: string;

  constructor(options: OpenAIJudgeProviderOptions) {
    super();
    this.apiKey = options.apiKey;
    this.model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const base =
      options.endpoint || process.env.OPENAI_BASE_URL || process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1';
    this.endpoint = base.endsWith('/chat/completions') ? base : `${base.replace(/\/+$/, '')}/chat/completions`;
  }

  protected async judgeRule(node: SemanticJudgeInput['node'], rule: SemanticRuleSpec): Promise<SemanticJudgeResult> {
    const systemPrompt = buildJudgeSystemPrompt();
    const userPrompt = buildJudgeUserPrompt(node, rule);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`OpenAI API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI API returned empty or missing message content in response.');
    }

    return parseJudgeResponse(content, Object.keys(rule.verdicts));
  }
}
