/**
 * Phone validation – Abstract API (free tier: 100/month).
 * Sign up: https://www.abstractapi.com/phone-validation-api
 * Set ABSTRACT_PHONE_API_KEY in .env (optional; skips if missing).
 * Alternative: NumVerify (NUMVERIFY_API_KEY) – 250 free/month.
 */

const ABSTRACT_BASE = 'https://phonevalidation.abstractapi.com/v1';
const NUMVERIFY_BASE = 'http://apilayer.net/api/validate';

function digitsOnly(phone) {
  if (phone == null) return '';
  return String(phone).replace(/\D/g, '');
}

async function validateWithAbstract(phone) {
  const key = process.env.ABSTRACT_PHONE_API_KEY;
  if (!key) return null;
  const num = digitsOnly(phone);
  if (num.length < 10) return null;

  const url = new URL(ABSTRACT_BASE);
  url.searchParams.set('api_key', key);
  url.searchParams.set('phone', num);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();

  return {
    valid: data.valid === true,
    country: data.country?.code || null,
    location: data.location || null,
    type: data.type || null,
    carrier: data.carrier || null,
  };
}

async function validateWithNumVerify(phone) {
  const key = process.env.NUMVERIFY_API_KEY;
  if (!key) return null;
  const num = digitsOnly(phone);
  if (num.length < 10) return null;

  const url = new URL(NUMVERIFY_BASE);
  url.searchParams.set('access_key', key);
  url.searchParams.set('number', num);
  url.searchParams.set('country_code', 'US');

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.valid !== true && data.valid !== false) return null;

  return {
    valid: data.valid === true,
    country: data.country_code || null,
    location: data.location || null,
    line_type: data.line_type || null,
    carrier: data.carrier || null,
  };
}

/**
 * Validate phone; uses Abstract API if key set, else NumVerify if key set.
 */
async function validatePhone(phone) {
  const withAbstract = await validateWithAbstract(phone);
  if (withAbstract) return withAbstract;
  return validateWithNumVerify(phone);
}

module.exports = { validatePhone, digitsOnly };
