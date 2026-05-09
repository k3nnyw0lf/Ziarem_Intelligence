/**
 * Cloudflare Workers AI — free tier: 10K neurons/day.
 * Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (per Kenneth's CF account).
 * Default model: @cf/meta/llama-3.1-8b-instruct (cheap on neurons).
 */

const DEFAULT_MODEL = process.env.CF_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct-fast';
const EMBED_MODEL = process.env.CF_EMBED_MODEL || '@cf/baai/bge-base-en-v1.5';

module.exports = {
  name: 'cf-ai',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: true,
  isConfigured: (env) => !!env.CLOUDFLARE_ACCOUNT_ID && !!env.CLOUDFLARE_API_TOKEN,

  async call({ system, user, input, maxTokens = 1024, task }) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const model = task === 'embed' ? EMBED_MODEL : DEFAULT_MODEL;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

    const body = task === 'embed'
      ? { text: [String(input).slice(0, 8000)] }
      : {
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: user },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
        };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = new Error(`cf-ai ${res.status}: ${(await res.text()).slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    const j = await res.json();
    if (task === 'embed') {
      return {
        text: null,
        embedding: j?.result?.data?.[0],
        model,
        tokens_in: 0,
        tokens_out: 0,
        est_cost_usd: 0,
      };
    }
    return {
      text: j?.result?.response ?? j?.result?.choices?.[0]?.message?.content ?? '',
      model,
      tokens_in: j?.result?.usage?.prompt_tokens ?? 0,
      tokens_out: j?.result?.usage?.completion_tokens ?? 0,
      est_cost_usd: 0,
    };
  },
};
