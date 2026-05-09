/**
 * Claude Sonnet 4.6 — for high-stakes "best loan for client X" reasoning.
 * Pricing: $3/Mtok input, $15/Mtok output. Cached read $0.30/Mtok.
 */

const DEFAULT_MODEL = process.env.ANTHROPIC_SONNET_MODEL || 'claude-sonnet-4-6';
const PRICE_IN = 3.0 / 1_000_000;
const PRICE_OUT = 15.0 / 1_000_000;
const PRICE_CACHE_READ = 0.30 / 1_000_000;
const PRICE_CACHE_WRITE = 3.75 / 1_000_000;

module.exports = {
  name: 'anthropic-sonnet',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: false,
  isConfigured: (env) => !!env.ANTHROPIC_API_KEY,

  async call({ system, user, maxTokens = 2048, wantJson = false }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const body = {
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system: system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : undefined,
      messages: [{ role: 'user', content: user + (wantJson ? '\n\nRespond with JSON only.' : '') }],
      temperature: 0.2,
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = new Error(`anthropic-sonnet ${res.status}: ${(await res.text()).slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    const j = await res.json();
    const text = j?.content?.find((c) => c.type === 'text')?.text ?? '';
    const u = j?.usage || {};
    const tokens_in = u.input_tokens || 0;
    const tokens_out = u.output_tokens || 0;
    const cache_hits = u.cache_read_input_tokens || 0;
    const cache_writes = u.cache_creation_input_tokens || 0;
    const est_cost_usd =
      tokens_in * PRICE_IN + tokens_out * PRICE_OUT +
      cache_hits * PRICE_CACHE_READ + cache_writes * PRICE_CACHE_WRITE;
    return { text, model: DEFAULT_MODEL, tokens_in, tokens_out, cache_hits, cache_writes, est_cost_usd };
  },
};
