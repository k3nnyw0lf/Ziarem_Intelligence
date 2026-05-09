-- ============================================================================
-- Ziarem LLM Cost Tracking
-- Tracks every LLM call across providers (free + paid) so we can:
--   1. Enforce daily $/quota caps per provider
--   2. Report what we spent vs saved by tiered routing
--   3. Detect rate-limit drift and re-route automatically
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_calls (
  id            BIGSERIAL PRIMARY KEY,
  provider      VARCHAR(50) NOT NULL,        -- 'gemini-api' | 'gemini-cli' | 'groq' | 'openrouter' | 'cf-ai' | 'ollama' | 'anthropic'
  model         VARCHAR(100) NOT NULL,
  task          VARCHAR(50) NOT NULL,        -- 'triage' | 'chat' | 'embed' | 'recommend' | 'extract' | 'classify'
  comm_id       INTEGER REFERENCES communications(id) ON DELETE SET NULL,
  lead_id       BIGINT REFERENCES leads(autoId_ui) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL,        -- 'ok' | 'rate_limited' | 'error' | 'refused' | 'fallback'
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cache_hits    INTEGER,
  cache_writes  INTEGER,
  est_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  error         TEXT,
  request_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_provider_day ON llm_calls (provider, (created_at::date));
CREATE INDEX IF NOT EXISTS idx_llm_calls_task ON llm_calls (task);
CREATE INDEX IF NOT EXISTS idx_llm_calls_lead ON llm_calls (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_llm_calls_status ON llm_calls (status);

-- ============================================================================
-- Daily quota config — adjustable, polled by router before every call
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_provider_quota (
  provider           VARCHAR(50) PRIMARY KEY,
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  priority           INTEGER NOT NULL DEFAULT 50,   -- lower = tried first (free tiers low)
  daily_request_cap  INTEGER,                       -- NULL = unlimited
  daily_token_cap    BIGINT,
  daily_usd_cap      NUMERIC(10,2),
  rpm_cap            INTEGER,                       -- requests per minute
  notes              TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO llm_provider_quota (provider, enabled, priority, daily_request_cap, rpm_cap, daily_usd_cap, notes) VALUES
  ('ollama',        TRUE, 10,  NULL,  NULL, 0,    'Local Synology Ollama. Free, slow. Default for embeddings + bulk.'),
  ('gemini-api',    TRUE, 20,  1500,  15,   0,    'Google AI Studio gemini-2.5-flash free tier (1500/day, 15 RPM).'),
  ('groq',          TRUE, 30,  14400, 30,   0,    'Groq free tier (Llama 3.3 70B, 30 RPM, ~14.4K/day).'),
  ('openrouter',    TRUE, 40,  200,   NULL, 0,    'OpenRouter free models (DeepSeek/Gemini/Llama). 200/day combined.'),
  ('cf-ai',         TRUE, 50,  10000, NULL, 0,    'Cloudflare Workers AI free tier (10K neurons/day).'),
  ('gemini-cli',    FALSE,60,  100,   NULL, 0,    'Subprocess of gemini CLI. Slow. Disabled by default — only for ad-hoc.'),
  ('anthropic-haiku', TRUE, 80, NULL, NULL, 5,    'Claude Haiku 4.5 — paid fallback. $5/day cap.'),
  ('anthropic-sonnet', TRUE, 90, NULL, NULL, 5,   'Claude Sonnet 4.6 — only for high-stakes chat. $5/day cap. Uses prompt caching.'),
  ('anthropic-opus', FALSE, 100, NULL, NULL, 2,   'Claude Opus 4.7 — disabled by default. Manual unlock.')
ON CONFLICT (provider) DO NOTHING;

-- ============================================================================
-- Rolling 24h usage view — used by router to decide if a provider is over cap
-- ============================================================================

CREATE OR REPLACE VIEW v_llm_provider_usage_24h AS
SELECT
  q.provider,
  q.enabled,
  q.priority,
  q.daily_request_cap,
  q.daily_token_cap,
  q.daily_usd_cap,
  q.rpm_cap,
  COALESCE(c.requests_today, 0)            AS requests_today,
  COALESCE(c.tokens_today, 0)              AS tokens_today,
  COALESCE(c.cost_today_usd, 0)            AS cost_today_usd,
  COALESCE(c.requests_last_minute, 0)      AS requests_last_minute,
  CASE
    WHEN q.daily_request_cap IS NOT NULL AND COALESCE(c.requests_today,0) >= q.daily_request_cap THEN 'cap_requests'
    WHEN q.daily_token_cap   IS NOT NULL AND COALESCE(c.tokens_today,0)   >= q.daily_token_cap   THEN 'cap_tokens'
    WHEN q.daily_usd_cap     IS NOT NULL AND COALESCE(c.cost_today_usd,0) >= q.daily_usd_cap     THEN 'cap_cost'
    WHEN q.rpm_cap           IS NOT NULL AND COALESCE(c.requests_last_minute,0) >= q.rpm_cap     THEN 'cap_rpm'
    WHEN NOT q.enabled                                                                            THEN 'disabled'
    ELSE 'available'
  END AS status
FROM llm_provider_quota q
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                         AS requests_today,
    SUM(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)) AS tokens_today,
    SUM(est_cost_usd)                AS cost_today_usd,
    COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '1 minute') AS requests_last_minute
  FROM llm_calls
  WHERE provider = q.provider
    AND created_at > date_trunc('day', now() AT TIME ZONE 'UTC')
    AND status IN ('ok', 'fallback')
) c ON TRUE;

-- ============================================================================
-- Daily savings report — what tiered routing saved us vs all-Anthropic
-- ============================================================================

CREATE OR REPLACE VIEW v_llm_savings_report AS
WITH calls AS (
  SELECT
    created_at::date AS day,
    provider,
    task,
    SUM(COALESCE(tokens_in, 0))  AS tokens_in,
    SUM(COALESCE(tokens_out, 0)) AS tokens_out,
    SUM(est_cost_usd)            AS cost_usd,
    COUNT(*)                     AS calls
  FROM llm_calls
  WHERE status IN ('ok','fallback')
  GROUP BY 1, 2, 3
)
SELECT
  day,
  SUM(calls)        AS total_calls,
  SUM(cost_usd)     AS actual_cost_usd,
  SUM(tokens_in)    AS tokens_in,
  SUM(tokens_out)   AS tokens_out,
  -- Sonnet-equivalent cost: $3/Mtok in + $15/Mtok out (no caching), as a comparison baseline
  ROUND((SUM(tokens_in) * 3.0 + SUM(tokens_out) * 15.0) / 1000000.0, 4) AS hypothetical_sonnet_cost_usd,
  ROUND(((SUM(tokens_in) * 3.0 + SUM(tokens_out) * 15.0) / 1000000.0) - SUM(cost_usd), 4) AS savings_vs_sonnet_usd
FROM calls
GROUP BY day
ORDER BY day DESC;

COMMENT ON TABLE llm_calls IS 'Every LLM call is logged here — used for cost reporting and router quota enforcement.';
COMMENT ON TABLE llm_provider_quota IS 'Per-provider caps. Set daily_usd_cap=0 for free tiers, low priority for cheap providers.';
COMMENT ON VIEW v_llm_provider_usage_24h IS 'Router queries this to decide which provider is available for the next call.';
COMMENT ON VIEW v_llm_savings_report IS 'Daily report of money saved by tiered routing vs naive all-Sonnet baseline.';
