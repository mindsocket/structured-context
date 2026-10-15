/**
 * Model-validation smoke tests: check that every bundled provider's configured model actually
 * exists on its endpoint. Unlike live.test.ts these make no judgement call — they only prove the
 * model id resolves, so the check stays cheap and never sends real content.
 *
 * Opt in with SCTX_MODEL_VALIDATION=1 (`bun run test:models`); each check runs only when its
 * provider's key is set. OpenRouter chat models validate keylessly against the public models
 * list; decisions endpoints expose no keyless catalog, so they take a minimal probe.
 */
import { describe, expect, it } from 'bun:test';
import { BUNDLED_PROVIDERS, hydrateProvider } from '../../src/judge/factory';
import type { HydratedProvider } from '../../src/judge/types';

const env = process.env as Record<string, string | undefined>;

function resolved(name: string): { model?: string; api: string } {
  const h: HydratedProvider = hydrateProvider(name, BUNDLED_PROVIDERS[name]!, env);
  return { model: h.model, api: h.api };
}

const CHECKABLE = Object.keys(BUNDLED_PROVIDERS).filter((name) => resolved(name).model !== undefined);

describe.skipIf(process.env.SCTX_MODEL_VALIDATION !== '1')('bundled models exist', () => {
  it.each(CHECKABLE)(
    '%s: model resolves on its endpoint',
    async (name) => {
      const { model, api } = resolved(name);

      if (api === 'openai-completions' && name.startsWith('openrouter')) {
        // OpenRouter's models list is public and keyless; chat models appear in it.
        const res = await fetch('https://openrouter.ai/api/v1/models');
        expect(res.ok).toBe(true);
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        expect(new Set((data.data ?? []).map((m) => m.id)).has(model!)).toBe(true);
        return;
      }

      const keyEnv = BUNDLED_PROVIDERS[name]!.apiKeyEnv!;
      const key = env[keyEnv];
      if (!key) {
        console.log(`skip ${name}: ${keyEnv} not set`);
        return;
      }

      if (api === 'openrouter-decisions') {
        // The decisions catalog is not the public models list (verified: live slugs are absent from
        // it), so probe the endpoint: an unknown model is a 400 naming the model, a known one is not.
        const res = await fetch('https://openrouter.ai/api/alpha/decisions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            state: {},
            questions: { probe: { type: 'choice', instructions: 'Answer a.', criteria: { a: 'always' } } },
          }),
        });
        const text = await res.text();
        expect(res.ok || !/does not exist/i.test(text)).toBe(true);
        return;
      }

      if (api === 'openai-decisions') {
        // No keyless catalog; an unknown model is 404 model_not_found, a known one is not.
        const res = await fetch('https://api.openai.com/v1/decisions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            input: 'model existence check',
            questions: [{ type: 'predicate', name: 'probe', instructions: 'Answer yes.' }],
          }),
        });
        expect(res.status).not.toBe(404);
        return;
      }

      if (api === 'anthropic-messages' || api === 'openai-completions') {
        if (api === 'anthropic-messages') {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          });
          expect(res.ok).toBe(true);
          const data = (await res.json()) as { data?: Array<{ id: string }> };
          expect(new Set((data.data ?? []).map((m) => m.id)).has(model!)).toBe(true);
        } else {
          const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } });
          expect(res.ok).toBe(true);
          const data = (await res.json()) as { data?: Array<{ id: string }> };
          expect(new Set((data.data ?? []).map((m) => m.id)).has(model!)).toBe(true);
        }
        return;
      }

      console.log(`skip ${name}: no validation mechanism for api "${api}"`);
    },
    30_000,
  );
});
