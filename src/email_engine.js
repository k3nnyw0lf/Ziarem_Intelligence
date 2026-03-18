/**
 * Ziarem Unified Communication Engine – sending (Nodemailer).
 * sendVideoEmail: fetch business SMTP, build HTML with fake player (thumbnail + play overlay), send, save to communications.
 */

const nodemailer = require('nodemailer');
const { pool } = require('./db');

const PLAY_BUTTON_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 48" width="68" height="48"><path fill="%23f00" d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.31 1.55c-2.93.78-4.64 3.26-5.42 6.19C.06 13.46 0 24 0 24s.06 10.54 1.61 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.69-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.54 68 24 68 24s-.06-10.54-1.61-16.26z"/><path fill="%23fff" d="M45 24L27 14v20"/></svg>'
);

function extractYoutubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  const m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function buildVideoFakePlayerHtml(youtubeUrl, videoId) {
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const fallbackThumb = `https://img.youtube.com/vi/${videoId}/0.jpg`;
  return `
<div style="position:relative;display:inline-block;max-width:560px;">
  <a href="${youtubeUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener" style="text-decoration:none;">
    <img src="${fallbackThumb}" alt="Video thumbnail" width="560" height="315" style="display:block;width:100%;max-width:560px;height:auto;border:0;" />
    <img src="${PLAY_BUTTON_SVG}" alt="Play" width="68" height="48" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;" />
  </a>
</div>`;
}

async function getBusinessSmtp(businessId) {
  const r = await pool.query(
    'SELECT id, business_name, email_user, email_pass, smtp_host FROM business_emails WHERE id = $1',
    [businessId]
  );
  if (!r.rows[0]) throw new Error(`Business not found: ${businessId}`);
  return r.rows[0];
}

async function getLeadEmail(leadId) {
  const r = await pool.query(
    'SELECT email_addr FROM leads WHERE autoId_ui = $1',
    [leadId]
  );
  return r.rows[0]?.email_addr || null;
}

/**
 * Send a video email to a lead: HTML body with fake player (YouTube thumbnail + play overlay), save to communications.
 * @param {number} leadId - leads.autoId_ui
 * @param {number} businessId - business_emails.id
 * @param {string} youtubeLink - e.g. https://www.youtube.com/watch?v=VIDEO_ID
 * @param {string} message - Optional plain text / HTML message above or below the video block
 */
async function sendVideoEmail(leadId, businessId, youtubeLink, message = '') {
  const videoId = extractYoutubeVideoId(youtubeLink);
  if (!videoId) throw new Error('Invalid YouTube URL');

  const [business, toEmail] = await Promise.all([
    getBusinessSmtp(businessId),
    getLeadEmail(leadId),
  ]);
  if (!toEmail) throw new Error(`Lead ${leadId} has no email_addr`);

  const subject = `Video for you`;
  const videoBlock = buildVideoFakePlayerHtml(youtubeLink, videoId);
  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;">
${message ? `<div style="margin-bottom:1em;">${message.replace(/\n/g, '<br>')}</div>` : ''}
${videoBlock}
${message ? `<div style="margin-top:1em;">${message.replace(/\n/g, '<br>')}</div>` : ''}
</body>
</html>`;
  const bodyText = message + '\n\nWatch: ' + youtubeLink;

  const transporter = nodemailer.createTransport({
    host: business.smtp_host,
    port: 587,
    secure: false,
    auth: {
      user: business.email_user,
      pass: business.email_pass,
    },
  });

  const sentAt = new Date();
  await transporter.sendMail({
    from: business.email_user,
    to: toEmail,
    subject,
    text: bodyText,
    html: bodyHtml,
  });

  await pool.query(
    `INSERT INTO communications (lead_id, direction, subject, body_text, body_html, sent_at, business_id)
     VALUES ($1, 'OUTBOUND', $2, $3, $4, $5, $6)`,
    [leadId, subject, bodyText, bodyHtml, sentAt, businessId]
  );

  return { leadId, businessId, to: toEmail, subject, sentAt };
}

module.exports = {
  sendVideoEmail,
  getBusinessSmtp,
  buildVideoFakePlayerHtml,
  extractYoutubeVideoId,
};
