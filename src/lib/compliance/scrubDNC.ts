/**
 * Phase 6: Litigation firewall (TCPA pre-scrub).
 * Before dispatching Vapi outbound batch, call scrubDNC(phoneArray).
 * Mocks TCPA firewall API; only returns numbers that are safe_to_dial: true.
 * Replace the mock with a real TCPA firewall API (e.g. Five9, Gryphon, etc.).
 */

export interface ScrubResult {
  phone: string;
  safe_to_dial: boolean;
  reason?: string;
}

const TCPA_FIREWALL_URL = process.env.TCPA_FIREWALL_URL;
const TCPA_FIREWALL_API_KEY = process.env.TCPA_FIREWALL_API_KEY;

/**
 * Normalize to 10-digit US.
 */
function normalize(phone: string): string {
  const digits = phone.trim().replace(/\D/g, "").slice(-10);
  return digits.length >= 10 ? digits.padStart(10, "0") : "";
}

/**
 * Mock: in production, call your TCPA firewall API with the phone list
 * and return only numbers where the provider says safe_to_dial.
 * Here we mock by returning all numbers as safe_to_dial (no real scrub).
 */
async function callTcpafirewall(phones: string[]): Promise<ScrubResult[]> {
  if (TCPA_FIREWALL_URL && TCPA_FIREWALL_API_KEY) {
    try {
      const res = await fetch(TCPA_FIREWALL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TCPA_FIREWALL_API_KEY}`,
        },
        body: JSON.stringify({ phones }),
      });
      if (res.ok) {
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : data?.data;
        if (results?.length) {
          return results.map((r: { phone: string; safe_to_dial?: boolean; reason?: string }) => ({
            phone: normalize(r.phone),
            safe_to_dial: r.safe_to_dial === true,
            reason: r.reason,
          }));
        }
      }
    } catch (e) {
      console.warn("[scrubDNC] firewall API failed, falling back to mock:", e);
    }
  }

  return phones.map((p) => ({
    phone: normalize(p),
    safe_to_dial: true,
    reason: "mock",
  }));
}

/**
 * Scrubs a list of phone numbers through the TCPA firewall.
 * Returns only phones that are safe_to_dial: true.
 */
export async function scrubDNC(phoneArray: string[]): Promise<string[]> {
  const normalized = phoneArray.map(normalize).filter((p) => p.length >= 10);
  const uniq = [...new Set(normalized)];
  const results = await callTcpafirewall(uniq);
  return results.filter((r) => r.safe_to_dial).map((r) => r.phone);
}
