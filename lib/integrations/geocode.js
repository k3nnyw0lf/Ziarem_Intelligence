/**
 * Geocoding via Nominatim (OpenStreetMap) – free, no API key.
 * Usage policy: 1 request per second. https://nominatim.org/release-docs/develop/api/Search/
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

function buildAddress(lead) {
  const parts = [
    lead.address_1,
    lead.address_2,
    lead.city,
    lead.state,
    lead.zip_code,
  ].filter(Boolean);
  return parts.map((p) => String(p).trim()).join(', ');
}

/**
 * Geocode a single address string or a lead with address fields.
 * @param {string|object} addressOrLead - Full address string or object with address_1, city, state, zip_code
 * @returns {Promise<{ lat: number, lon: number, display_name?: string }|null>}
 */
async function geocode(addressOrLead) {
  const q = typeof addressOrLead === 'string'
    ? addressOrLead
    : buildAddress(addressOrLead);
  if (!q || !q.replace(/,/g, '').trim()) return null;

  const url = new URL('/search', NOMINATIM_BASE);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us'); // Ziarem US-focused

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'ZiaremIntelligence/1.0 (lead enrichment)' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const first = data[0];
  const lat = parseFloat(first.lat);
  const lon = parseFloat(first.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  return {
    lat,
    lon,
    display_name: first.display_name,
  };
}

module.exports = { geocode, buildAddress };
