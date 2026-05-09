/**
 * OpenRouter — gateway to many free models.
 * Sign up at https://openrouter.ai — set OPENROUTER_API_KEY.
 * Default model picks a free one; override via OPENROUTER_MODEL.
 *
 * Good free models (subject to availability — OpenRouter rotates):
 *   deepseek/deepseek-r1:free
 *   google/gemini-2.5-flash-exp:free
 *   meta-llama/llama-3.3-70b-instruct:free
 *   qwen/qwen-2.5-72b-instruct:free
 */

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-r1:free';

module.exports = {
  name: 'openrouter',
  defaultModel: DEFAULT_MODEL,
  supportsEmbed: false,
  isConfigured: (env) => !!env.OPENROUTER_API_KEY,

  async call({ system, user, maxTokens = 1024, wantJson = false }) {
    const apiKey = process.env.OPENROUTER_API_KEY;
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
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://ziarem.com',
        'X-Title': 'Ziarem Intelligence',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
      e.status = res.status;
      throw e;
    }
    const j = await res.json();
    // OpenRouter free models report usage even if cost is $0
    return {
      text: j?.choices?.[0]?.message?.content ?? '',
      model: j?.model || DEFAULT_MODEL,
      tokens_in: j?.usage?.prompt_tokens ?? 0,
      tokens_out: j?.usage?.completion_tokens ?? 0,
      est_cost_usd: 0,
    };
  },
};
