/**
 * Google AI Studio API — Gemini 2.5 Flash (free tier: 1500/day, 15 RPM).
 * Get a key at https://aistudio.google.com/app/apikey
 * Set GEMINI_API_KEY in .env
 *
 * Pricing for non-free tier (we cap at free): Flash $0.075/Mtok in, $0.30/Mtok out.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'text-embedding-004';

module.exports = {
  name: 'gemini-api',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: true,
  isConfigured: (env) => !!env.GEMINI_API_KEY,

  async call({ system, user, input, maxTokens = 1024, wantJson = false, task }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    if (task === 'embed') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: String(input).slice(0, 8000) }] } }),
      });
      if (!res.ok) throw httpErr(res, await res.text());
      const j = await res.json();
      return { text: null, embedding: j?.embedding?.values, model: EMBED_MODEL, tokens_in: 0, tokens_out: 0, est_cost_usd: 0 };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;
    const body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2,
        ...(wantJson ? { responseMimeType: 'application/json' } : {}),
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw httpErr(res, await res.text());
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    return {
      text,
      model: DEFAULT_MODEL,
      tokens_in: j?.usageMetadata?.promptTokenCount ?? 0,
      tokens_out: j?.usageMetadata?.candidatesTokenCount ?? 0,
      est_cost_usd: 0, // free tier
    };
  },
};

function httpErr(res, body) {
  const e = new Error(`gemini-api ${res.status}: ${body?.slice(0, 300)}`);
  e.status = res.status;
  return e;
}
