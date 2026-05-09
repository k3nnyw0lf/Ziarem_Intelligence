/**
 * Claude Haiku 4.5 — paid fallback when free tiers are exhausted.
 * Set ANTHROPIC_API_KEY.
 * Pricing: $1/Mtok input, $5/Mtok output. Cached read $0.10/Mtok.
 */

const DEFAULT_MODEL = process.env.ANTHROPIC_HAIKU_MODEL || 'claude-haiku-4-5-20251001';
const PRICE_IN = 1.0 / 1_000_000;
const PRICE_OUT = 5.0 / 1_000_000;
const PRICE_CACHE_READ = 0.10 / 1_000_000;
const PRICE_CACHE_WRITE = 1.25 / 1_000_000;

module.exports = {
  name: 'anthropic-haiku',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: false,
  isConfigured: (env) => !!env.ANTHROPIC_API_KEY,

  async call({ system, user, maxTokens = 1024, wantJson = false }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const systemBlocks = system
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const body = {
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system: systemBlocks,
      messages: [{ role: 'user', content: user + (wantJson ? '\n\nRespond with JSON only — no prose, no markdown fences.' : '') }],
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
      const e = new Error(`anthropic-haiku ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
    return {
      text,
      model: DEFAULT_MODEL,
      tokens_in, tokens_out, cache_hits, cache_writes,
      est_cost_usd,
    };
  },
};
