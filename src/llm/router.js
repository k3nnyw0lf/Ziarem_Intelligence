/**
 * Ziarem LLM Router
 *
 * Tiered cascade — tries providers from cheapest to most expensive.
 * Skips providers that are over their daily cap (read from v_llm_provider_usage_24h).
 * Logs every call to llm_calls for cost reporting.
 *
 * Usage:
 *   const { llm } = require('./llm/router');
 *   const result = await llm.json({
 *     task: 'triage',
 *     system: 'You are...',
 *     user: 'Triage this email: ...',
 *     schema: { type: 'object', ... },
 *     maxTokens: 1024,
 *     preferPaid: false,        // when true, skip free tiers (use only when explicitly needed)
 *     allowedProviders: [...],  // optional whitelist
 *   });
 *   // result: { json, text, provider, model, tokens_in, tokens_out, cost_usd, latency_ms }
 */

const { pool } = require('../db');

// Each provider module exports: { name, isConfigured(env), call({system,user,schema,maxTokens}) }
const providers = {
  ollama:           require('./providers/ollama'),
  'gemini-api':     require('./providers/gemini_api'),
  groq:             require('./providers/groq'),
  openrouter:       require('./providers/openrouter'),
  'cf-ai':          require('./providers/cf_ai'),
  'gemini-cli':     require('./providers/gemini_cli'),
  'anthropic-haiku': require('./providers/anthropic_haiku'),
  'anthropic-sonnet':require('./providers/anthropic_sonnet'),
  'anthropic-opus':  require('./providers/anthropic_opus'),
};

async function getRoutingPlan(task, allowedProviders, preferPaid) {
  const r = await pool.query(`SELECT provider, priority, status FROM v_llm_provider_usage_24h ORDER BY priority ASC`);
  let candidates = r.rows.filter((row) => row.status === 'available');
  if (allowedProviders?.length) {
    candidates = candidates.filter((c) => allowedProviders.includes(c.provider));
  }
  if (preferPaid) {
    candidates = candidates.filter((c) => c.provider.startsWith('anthropic-'));
  }
  // Filter to providers that are configured (have keys)
  candidates = candidates.filter((c) => providers[c.provider]?.isConfigured?.(process.env));

  // Task-specific affinity
  if (task === 'embed') {
    candidates = candidates.filter((c) => providers[c.provider]?.supportsEmbed);
  }
  if (task === 'recommend' || task === 'reasoning') {
    // Push reasoning toward higher-quality models — exclude tiny ones
    const reasoners = ['gemini-api', 'openrouter', 'anthropic-sonnet', 'anthropic-haiku', 'groq'];
    candidates = candidates.sort((a, b) => reasoners.indexOf(a.provider) - reasoners.indexOf(b.provider))
                            .filter((c) => reasoners.includes(c.provider));
  }
  return candidates;
}

async function logCall({ provider, model, task, comm_id, lead_id, status, tokens_in, tokens_out, cache_hits, cache_writes, est_cost_usd, latency_ms, error, request_id }) {
  try {
    await pool.query(
      `INSERT INTO llm_calls (provider, model, task, comm_id, lead_id, status, tokens_in, tokens_out, cache_hits, cache_writes, est_cost_usd, latency_ms, error, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [provider, model, task, comm_id ?? null, lead_id ?? null, status, tokens_in ?? null, tokens_out ?? null, cache_hits ?? null, cache_writes ?? null, est_cost_usd ?? 0, latency_ms ?? null, error ?? null, request_id ?? null]
    );
  } catch (err) {
    console.error('[router] logCall failed', err.message);
  }
}

async function callOnce(providerName, opts) {
  const driver = providers[providerName];
  if (!driver) throw new Error(`Unknown provider: ${providerName}`);

  const start = Date.now();
  try {
    const result = await driver.call(opts);
    const latency_ms = Date.now() - start;
    await logCall({
      provider: providerName,
      model: result.model || driver.defaultModel,
      task: opts.task,
      comm_id: opts.comm_id,
      lead_id: opts.lead_id,
      status: 'ok',
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      cache_hits: result.cache_hits,
      cache_writes: result.cache_writes,
      est_cost_usd: result.est_cost_usd ?? 0,
      latency_ms,
    });
    return { ...result, provider: providerName, latency_ms };
  } catch (err) {
    const latency_ms = Date.now() - start;
    const isRateLimit = err.status === 429 || /rate.?limit|quota|too.?many/i.test(err.message || '');
    await logCall({
      provider: providerName,
      model: driver.defaultModel,
      task: opts.task,
      comm_id: opts.comm_id,
      lead_id: opts.lead_id,
      status: isRateLimit ? 'rate_limited' : 'error',
      latency_ms,
      error: err.message?.slice(0, 500),
    });
    throw err;
  }
}

async function callWithCascade(opts) {
  const plan = await getRoutingPlan(opts.task, opts.allowedProviders, opts.preferPaid);
  if (plan.length === 0) {
    throw new Error(`No LLM provider available for task=${opts.task}. Check llm_provider_quota / .env keys.`);
  }
  const errors = [];
  for (const { provider } of plan) {
    try {
      return await callOnce(provider, opts);
    } catch (err) {
      errors.push({ provider, message: err.message });
      const recoverable = err.status === 429 || err.status >= 500 || /rate.?limit|quota|timeout|network|fetch/i.test(err.message || '');
      if (!recoverable) {
        // hard failure (bad request, schema rejection) — bubble up
        throw err;
      }
      // continue to next provider in cascade
    }
  }
  const summary = errors.map((e) => `${e.provider}: ${e.message}`).join(' | ');
  const e = new Error(`All providers failed: ${summary}`);
  e.causes = errors;
  throw e;
}

const llm = {
  /** Plain text completion (no JSON guarantee) */
  async chat(opts) {
    return callWithCascade({ ...opts, task: opts.task || 'chat' });
  },
  /** JSON-only completion. Schema is passed through; provider validates if it supports it. */
  async json(opts) {
    const result = await callWithCascade({ ...opts, task: opts.task || 'extract', wantJson: true });
    try {
      result.json = typeof result.text === 'string' ? extractJson(result.text) : result.text;
    } catch (err) {
      const e = new Error(`Provider ${result.provider} returned invalid JSON: ${err.message}`);
      e.providerOutput = result.text;
      throw e;
    }
    return result;
  },
  /** Embedding (defaults to ollama → gemini → fallback hash) */
  async embed(text) {
    return callWithCascade({ task: 'embed', input: text, allowedProviders: ['ollama', 'gemini-api', 'cf-ai'] });
  },
};

function extractJson(text) {
  // Strip code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Find the first { or [ and the matching close
  const firstBrace = candidate.search(/[\[{]/);
  if (firstBrace < 0) return JSON.parse(candidate);
  return JSON.parse(candidate.slice(firstBrace).trim());
}

async function disableProvider(provider, reason) {
  await pool.query(`UPDATE llm_provider_quota SET enabled = FALSE, notes = COALESCE(notes,'') || ' | DISABLED: ' || $2, updated_at = now() WHERE provider = $1`, [provider, reason]);
}

async function enableProvider(provider) {
  await pool.query(`UPDATE llm_provider_quota SET enabled = TRUE, updated_at = now() WHERE provider = $1`, [provider]);
}

async function dailyReport(days = 7) {
  const r = await pool.query(`SELECT * FROM v_llm_savings_report WHERE day > current_date - $1::int ORDER BY day DESC`, [days]);
  return r.rows;
}

module.exports = { llm, callWithCascade, getRoutingPlan, disableProvider, enableProvider, dailyReport, logCall };
