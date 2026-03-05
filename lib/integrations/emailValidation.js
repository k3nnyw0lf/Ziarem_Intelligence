/**
 * Email validation – Abstract API (free tier: 100/month).
 * Sign up: https://www.abstractapi.com/email-verification-validation-api
 * Set ABSTRACT_EMAIL_API_KEY in .env (optional; skips if missing).
 */

const BASE = 'https://emailvalidation.abstractapi.com/v1';

async function validateEmail(email) {
  const key = process.env.ABSTRACT_EMAIL_API_KEY;
  if (!key || !email || !String(email).trim()) return null;

  const url = new URL(BASE);
  url.searchParams.set('api_key', key);
  url.searchParams.set('email', String(email).trim());

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();

  return {
    email: data.email,
    valid: data.is_valid_format?.value === true,
    deliverable: data.deliverability === 'DELIVERABLE',
    quality_score: data.quality_score != null ? Number(data.quality_score) : null,
    is_disposable: data.is_disposable_email?.value === true,
    is_role_account: data.is_role_email?.value === true,
    autocorrect: data.autocorrect || null,
  };
}

module.exports = { validateEmail };
