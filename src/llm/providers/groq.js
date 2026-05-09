/**
 * Groq — Llama 3.3 70B Versatile (free tier: 30 RPM, ~14400/day).
 * Sign up at https://console.groq.com — set GROQ_API_KEY.
 * Free at the time of writing; very fast (>500 tok/s).
 */

const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

module.exports = {
  name: 'groq',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: false,
  isConfigured: (env) => !!env.GROQ_API_KEY,

  async call({ system, user, maxTokens = 1024, wantJson = false }) {
    const apiKey = process.env.GROQ_API_KEY;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    const body = {
      model: DEFAULT_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
    };
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = new Error(`groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    const j = await res.json();
    return {
      text: j?.choices?.[0]?.message?.content ?? '',
      model: DEFAULT_MODEL,
      tokens_in: j?.usage?.prompt_tokens ?? 0,
      tokens_out: j?.usage?.completion_tokens ?? 0,
      est_cost_usd: 0,
    };
  },
};
