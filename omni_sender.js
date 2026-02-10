#!/usr/bin/env node
/**
 * Ziarem Omni-SMTP Marketing Engine – batch sender.
 * Dependencies: nodemailer, bottleneck.
 *
 * Usage: node omni_sender.js <campaignId>
 *    or: node omni_sender.js  (prompts or uses CAMPAIGN_ID env)
 */

const nodemailer = require('nodemailer');
const Bottleneck = require('bottleneck');
const { pool } = require('./src/db');

const BATCH_SIZE = 50;
const TRACKING_BASE_URL = process.env.TRACKING_BASE_URL || 'https://ziarem.com/api/track';
const CONCURRENCY = 2;

/** Map lead ziarem_tag → smtp_identities.business_tag */
const TAG_TO_BUSINESS = {
  WOLF_RENO_TARGET: 'WOLF',
  WOLF_INSURANCE_LIABILITY: 'WOLF',
  WOLF_INSURANCE_HIGH_RISK: 'WOLF',
  LYCO_TAX_LEAD: 'LYCO',
  DISPUTE_DISTRESSED: 'DISPUTE',
  DOS_REFI_TARGET: 'DOS',
  DOS_FIRST_TIME_BUYER: 'DOS',
  RE4LTY_FLIP_OPPORTUNITY: 'RE4LTY',
  CLOSED_BY_WHOM_TITLE: 'RE4LTY',
};

const PLAY_BUTTON_SVG_DATA = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 48" width="68" height="48"><path fill="%23f00" d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.31 1.55c-2.93.78-4.64 3.26-5.42 6.19C.06 13.46 0 24 0 24s.06 10.54 1.61 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.69-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.54 68 24 68 24s-.06-10.54-1.61-16.26z"/><path fill="%23fff" d="M45 24L27 14v20"/></svg>'
);

/**
 * Replace {{VIDEO:YOUTUBE_ID}} in html with clickable thumbnail + play overlay.
 */
function replaceVideoPlaceholders(html) {
  if (!html || typeof html !== 'string') return html;
  return html.replace(/\{\{VIDEO:([a-zA-Z0-9_-]{11})\}\}/g, (_, youtubeId) => {
    const videoUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    const thumbUrl = `https://img.youtube.com/vi/${youtubeId}/0.jpg`;
    return `
<div style="position:relative;display:inline-block;max-width:560px;">
  <a href="${videoUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener" style="text-decoration:none;">
    <img src="${thumbUrl}" alt="Video thumbnail" width="560" height="315" style="display:block;width:100%;max-width:560px;height:auto;border:0;" />
    <img src="${PLAY_BUTTON_SVG_DATA}" alt="Play" width="68" height="48" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;" />
  </a>
</div>`;
  });
}

/**
 * Append invisible 1x1 tracking pixel to html.
 */
function appendTrackingPixel(html, trackingId) {
  const pixel = `<img src="${TRACKING_BASE_URL}?id=${encodeURIComponent(trackingId)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
  if (!html || typeof html !== 'string') return pixel;
  if (html.trim().toLowerCase().endsWith('</body>')) {
    return html.replace(/\s*<\/body\>/i, `${pixel}</body>`);
  }
  return html + pixel;
}

/**
 * Get business_tag for SMTP identity from lead's ziarem_tags (first match wins).
 */
function getBusinessTagForLead(ziaremTags) {
  const tags = Array.isArray(ziaremTags) ? ziaremTags : (ziaremTags ? [ziaremTags] : []);
  for (const tag of tags) {
    const t = String(tag).trim().toUpperCase();
    if (TAG_TO_BUSINESS[t]) return TAG_TO_BUSINESS[t];
  }
  return null;
}

/**
 * Fetch campaign by id.
 */
async function getCampaign(campaignId) {
  const r = await pool.query(
    'SELECT id, name, business_tag, status, template_html FROM marketing_campaigns WHERE id = $1',
    [campaignId]
  );
  return r.rows[0] || null;
}

/**
 * Fetch up to BATCH_SIZE Pending queue items for campaign.
 */
async function getPendingQueueItems(campaignId) {
  const r = await pool.query(
    `SELECT id, campaign_id, lead_id, status, scheduled_for
     FROM campaign_queue
     WHERE campaign_id = $1 AND status = 'Pending'
     ORDER BY scheduled_for ASC NULLS FIRST, created_at ASC
     LIMIT $2`,
    [campaignId, BATCH_SIZE]
  );
  return r.rows;
}

/**
 * Fetch lead by autoId_ui (email, ziarem_tags).
 */
async function getLead(leadId) {
  const r = await pool.query(
    'SELECT autoId_ui, email_addr, first_name, last_name, ziarem_tags FROM leads WHERE autoId_ui = $1',
    [leadId]
  );
  return r.rows[0] || null;
}

/**
 * Fetch SMTP identity by business_tag. Returns first row; caller must check sent_today < daily_limit.
 */
async function getSmtpIdentity(businessTag) {
  const r = await pool.query(
    'SELECT id, business_tag, from_name, from_email, smtp_host, smtp_port, smtp_user, smtp_pass, daily_limit, sent_today FROM smtp_identities WHERE business_tag = $1',
    [businessTag]
  );
  return r.rows[0] || null;
}

/**
 * Create email_tracking row; return tracking_id.
 */
async function createTrackingRecord(leadId) {
  const r = await pool.query(
    'INSERT INTO email_tracking (lead_id) VALUES ($1) RETURNING tracking_id',
    [leadId]
  );
  return r.rows[0].tracking_id;
}

/**
 * Mark queue item Sent and increment identity sent_today.
 */
async function markSent(queueId, identityId) {
  await pool.query(
    'UPDATE campaign_queue SET status = $1, sent_at = now() WHERE id = $2',
    ['Sent', queueId]
  );
  await pool.query(
    'UPDATE smtp_identities SET sent_today = sent_today + 1, updated_at = now() WHERE id = $1',
    [identityId]
  );
}

/**
 * Mark queue item Failed with error message.
 */
async function markFailed(queueId, errorMessage) {
  await pool.query(
    'UPDATE campaign_queue SET status = $1, error_message = $2 WHERE id = $3',
    ['Failed', String(errorMessage).slice(0, 1000), queueId]
  );
}

/**
 * Send one marketing email. Returns { ok, error? }.
 */
async function sendOne(campaign, queueItem, lead, identity, limiter) {
  const toEmail = lead?.email_addr;
  if (!toEmail) {
    await markFailed(queueItem.id, 'Lead has no email');
    return { ok: false, error: 'No email' };
  }

  const trackingId = await createTrackingRecord(lead.autoId_ui);
  let html = campaign.template_html || '';
  html = replaceVideoPlaceholders(html);
  html = appendTrackingPixel(html, trackingId);

  const transporter = nodemailer.createTransport({
    host: identity.smtp_host,
    port: identity.smtp_port,
    secure: identity.smtp_port === 465,
    auth: {
      user: identity.smtp_user,
      pass: identity.smtp_pass,
    },
  });

  return limiter.schedule(async () => {
    try {
      await transporter.sendMail({
        from: `"${identity.from_name}" <${identity.from_email}>`,
        to: toEmail,
        subject: campaign.name,
        html,
      });
      await markSent(queueItem.id, identity.id);
      return { ok: true };
    } catch (err) {
      await markFailed(queueItem.id, err.message);
      return { ok: false, error: err.message };
    }
  });
}

/**
 * Process a batch of Pending queue items for a campaign: resolve lead → business_tag → identity,
 * respect daily_limit, apply video placeholder and tracking pixel, send via nodemailer (rate-limited).
 */
async function sendMarketingBatch(campaignId) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }
  if (campaign.status !== 'Active') {
    console.warn(`Campaign ${campaignId} status is "${campaign.status}". Run anyway.`);
  }

  const items = await getPendingQueueItems(campaignId);
  if (items.length === 0) {
    return { campaignId, sent: 0, failed: 0, skipped: 0, message: 'No pending items' };
  }

  const limiter = new Bottleneck({ maxConcurrent: CONCURRENCY });
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items) {
    const lead = await getLead(item.lead_id);
    if (!lead) {
      await markFailed(item.id, 'Lead not found');
      failed++;
      continue;
    }

    const businessTag = getBusinessTagForLead(lead.ziarem_tags);
    if (!businessTag) {
      await markFailed(item.id, 'No SMTP mapping for lead tags');
      failed++;
      continue;
    }

    const identity = await getSmtpIdentity(businessTag);
    if (!identity) {
      await markFailed(item.id, `No SMTP identity for business_tag=${businessTag}`);
      failed++;
      continue;
    }

    if (identity.sent_today >= identity.daily_limit) {
      skipped++;
      continue;
    }

    const result = await sendOne(campaign, item, lead, identity, limiter);
    if (result.ok) sent++;
    else failed++;
  }

  return { campaignId, sent, failed, skipped, total: items.length };
}

async function main() {
  const campaignId = process.argv[2] || process.env.CAMPAIGN_ID;
  if (!campaignId) {
    console.error('Usage: node omni_sender.js <campaignId>');
    console.error('   or set CAMPAIGN_ID env var.');
    process.exit(1);
  }

  try {
    const result = await sendMarketingBatch(campaignId);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  sendMarketingBatch,
  replaceVideoPlaceholders,
  appendTrackingPixel,
  getBusinessTagForLead,
  TAG_TO_BUSINESS,
};
