/**
 * IP geolocation – ip-api.com (free, no key; 45 req/min).
 * Docs: http://ip-api.com/docs
 */

const BASE = 'http://ip-api.com/json';

async function getIpGeo(ip) {
  if (!ip || !String(ip).trim()) return null;
  const cleaned = String(ip).trim();
  // Basic IPv4/IPv6 check
  if (cleaned === '127.0.0.1' || cleaned === '::1') return null;

  const url = `${BASE}/${encodeURIComponent(cleaned)}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,isp,org`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'success') return null;

  return {
    country: data.country,
    countryCode: data.countryCode,
    region: data.regionName,
    city: data.city,
    zip: data.zip,
    lat: data.lat != null ? Number(data.lat) : null,
    lon: data.lon != null ? Number(data.lon) : null,
    isp: data.isp,
    org: data.org,
  };
}

module.exports = { getIpGeo };
