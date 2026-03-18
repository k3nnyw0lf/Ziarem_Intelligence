/**
 * Ziarem – free API integrations for lead enrichment.
 * All keys optional; missing key skips that provider.
 */

const { geocode } = require('./geocode');
const { validateEmail } = require('./emailValidation');
const { validatePhone } = require('./phoneValidation');
const { getIpGeo } = require('./ipGeo');

/** Delay helper for rate limits (e.g. Nominatim 1/sec). */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Enrich a lead using all configured free APIs.
 * @param {object} lead - Lead-like object with address_1, city, state, zip_code, email_addr, phone_nbr, mobile_phone, ip_addr, lat, lon
 * @param {object} opts - { skipGeocode, skipEmail, skipPhone, skipIp, rateLimitMs }
 * @returns {Promise<{ geocode, email, phone, ip, errors?: string[] }>}
 */
async function enrichLead(lead, opts = {}) {
  const result = { geocode: null, email: null, phone: null, ip: null };
  const errors = [];

  const rateLimitMs = opts.rateLimitMs ?? 1100; // Nominatim 1/sec

  // 1. Geocode if we have address and no lat/lon
  if (!opts.skipGeocode && lead && (lead.address_1 || lead.city || lead.zip_code)) {
    const hasCoords = lead.lat != null && lead.lon != null && !Number.isNaN(Number(lead.lat)) && !Number.isNaN(Number(lead.lon));
    if (!hasCoords) {
      try {
        result.geocode = await geocode(lead);
        await delay(rateLimitMs);
      } catch (e) {
        errors.push(`geocode: ${e.message}`);
      }
    }
  }

  // 2. Email validation
  if (!opts.skipEmail && lead?.email_addr) {
    try {
      result.email = await validateEmail(lead.email_addr);
    } catch (e) {
      errors.push(`email: ${e.message}`);
    }
  }

  // 3. Phone validation (prefer mobile, then phone_nbr)
  const phone = lead?.mobile_phone || lead?.phone_nbr;
  if (!opts.skipPhone && phone) {
    try {
      result.phone = await validatePhone(phone);
    } catch (e) {
      errors.push(`phone: ${e.message}`);
    }
  }

  // 4. IP geolocation
  if (!opts.skipIp && lead?.ip_addr) {
    try {
      result.ip = await getIpGeo(lead.ip_addr);
    } catch (e) {
      errors.push(`ip: ${e.message}`);
    }
  }

  if (errors.length) result.errors = errors;
  return result;
}

module.exports = {
  enrichLead,
  geocode,
  validateEmail: require('./emailValidation').validateEmail,
  validatePhone: require('./phoneValidation').validatePhone,
  getIpGeo,
};
