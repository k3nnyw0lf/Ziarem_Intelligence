/**
 * Claude Opus 4.7 — disabled by default. Manual unlock for special cases.
 * Pricing: $15/Mtok input, $75/Mtok output. Use only when Sonnet has failed AND the answer is high-stakes.
 */

const DEFAULT_MODEL = process.env.ANTHROPIC_OPUS_MODEL || 'claude-opus-4-7';
const PRICE_IN = 15.0 / 1_000_000;
const PRICE_OUT = 75.0 / 1_000_000;

module.exports = {
  name: 'anthropic-opus',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: false,
  isConfigured: (env) => !!env.ANTHROPIC_API_KEY && env.ANTHROPIC_OPUS_ENABLED === 'true',

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
      const e = new Error(`anthropic-opus ${res.status}: ${(await res.text()).slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    const j = await res.json();
    const text = j?.content?.find((c) => c.type === 'text')?.text ?? '';
    const u = j?.usage || {};
    const tokens_in = u.input_tokens || 0;
    const tokens_out = u.output_tokens || 0;
    return { text, model: DEFAULT_MODEL, tokens_in, tokens_out, est_cost_usd: tokens_in * PRICE_IN + tokens_out * PRICE_OUT };
  },
};
