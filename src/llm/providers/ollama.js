/**
 * Local Ollama (Synology NAS).
 * Free, no API limits. Slower (CPU/iGPU on Synology) — best for batch / overnight.
 * Set OLLAMA_BASE_URL (default http://dosmortgage.us6.quickconnect.to:11434).
 *
 * Recommended models to pull on Synology:
 *   ollama pull nomic-embed-text   # 768d embeddings, 274MB
 *   ollama pull llama3.1:8b        # 4.7GB, decent for triage
 *   ollama pull qwen2.5:7b         # 4.4GB, JSON-strong
 */

const BASE = process.env.OLLAMA_BASE_URL || 'http://dosmortgage.us6.quickconnect.to:11434';
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:7b';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

module.exports = {
  name: 'ollama',
  defaultModel: CHAT_MODEL,
  supportsEmbed: true,
  isConfigured: (env) => !!(env.OLLAMA_BASE_URL || env.OLLAMA_ENABLED === 'true' || true), // assumes deployed alongside
  async call({ system, user, input, maxTokens = 1024, wantJson = false, task }) {
    if (task === 'embed') {
      const res = await fetchTimeout(`${BASE}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: String(input).slice(0, 8000) }),
      }, 30000);
      if (!res.ok) throw httpErr('ollama-embed', res.status, await res.text());
      const j = await res.json();
      return { text: null, embedding: j?.embedding, model: EMBED_MODEL, tokens_in: 0, tokens_out: 0, est_cost_usd: 0 };
    }

    const res = await fetchTimeout(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        stream: false,
        options: { num_predict: maxTokens, temperature: 0.2 },
        format: wantJson ? 'json' : undefined,
      }),
    }, 90000);
    if (!res.ok) throw httpErr('ollama', res.status, await res.text());
    const j = await res.json();
    return {
      text: j?.message?.content ?? '',
      model: CHAT_MODEL,
      tokens_in: j?.prompt_eval_count ?? 0,
      tokens_out: j?.eval_count ?? 0,
      est_cost_usd: 0,
    };
  },
};

async function fetchTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

function httpErr(label, status, body) {
  const e = new Error(`${label} ${status}: ${(body || '').slice(0, 300)}`);
  e.status = status;
  return e;
}
