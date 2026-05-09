#!/usr/bin/env node
/**
 * Ziarem AI Worker
 * Processes communications WHERE ai_processed_at IS NULL.
 * For each: triage via LLM router (free tier first) → CRM update (lead match + activity + score event).
 *
 * Usage:
 *   node ai_worker.js                  # one pass over the queue, exit when empty
 *   node ai_worker.js --loop           # daemon mode, polls every 30s
 *   node ai_worker.js --loop --concurrency 4
 *   node ai_worker.js --max 200        # cap to 200 messages this run
 */

const { pool } = require('./src/db');
const { triageMessage, markFailed } = require('./src/ai_triage');
const { applyMatchAndUpdateCRM } = require('./src/lead_match');
const { dailyReport } = require('./src/llm/router');

const args = parseArgs(process.argv.slice(2));
const LOOP = !!args.loop;
const CONCURRENCY = Number(args.concurrency || 2);
const MAX = args.max ? Number(args.max) : Infinity;
const POLL_MS = 30000;
const MAX_ATTEMPTS = 3;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

async function nextBatch(n) {
  const r = await pool.query(
    `SELECT id FROM communications
      WHERE ai_processed_at IS NULL
        AND ai_attempts < $2
        AND direction = 'INBOUND'
      ORDER BY sent_at DESC
      LIMIT $1`,
    [n, MAX_ATTEMPTS]
  );
  return r.rows.map((r) => r.id);
}

async function processOne(commId) {
  try {
    const result = await triageMessage({ comm_id: commId });
    const match = await applyMatchAndUpdateCRM(commId);
    return {
      ok: true, commId,
      provider: result.provider,
      cost: result.cost,
      leadId: match.leadId,
      method: match.method,
    };
  } catch (err) {
    await markFailed(commId, err);
    return { ok: false, commId, error: err.message };
  }
}

async function runOnePass() {
  let processed = 0;
  while (processed < MAX) {
    const batch = await nextBatch(Math.min(CONCURRENCY * 4, MAX - processed));
    if (batch.length === 0) break;

    const ids = batch.slice(0, CONCURRENCY);
    const results = await Promise.all(ids.map(processOne));
    for (const r of results) {
      const tag = r.ok ? `[${r.provider}] $${(r.cost || 0).toFixed(6)}` : `[FAIL] ${r.error?.slice(0, 80)}`;
      const lead = r.leadId ? `lead#${r.leadId}` : 'no-match';
      console.log(`  comm#${r.commId} ${tag} ${r.ok ? lead : ''}`);
      processed++;
    }
    if (processed >= MAX) break;
  }
  return processed;
}

async function run() {
  console.log(`AI Worker starting | loop=${LOOP} concurrency=${CONCURRENCY} max=${MAX === Infinity ? '∞' : MAX}`);
  if (LOOP) {
    while (true) {
      const n = await runOnePass();
      if (n === 0) {
        await sleep(POLL_MS);
      } else if (n % 50 === 0) {
        const report = await dailyReport(1);
        console.log('today:', report[0]);
      }
    }
  } else {
    const n = await runOnePass();
    console.log(`processed ${n} message(s)`);
    const report = await dailyReport(1);
    console.log('today:', report[0]);
    await pool.end();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
