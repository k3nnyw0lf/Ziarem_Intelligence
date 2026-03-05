/**
 * Phase 9: Lifetime Digital Twin Engine — persistent AI concierge for Closed leads.
 * Integrates NOAA (weather alerts) and Fed/Treasury (rate alerts); uses Gemini to draft
 * hyper-personalized SMS and sends via Twilio for cross-sell (RENO storm prep, Dos refi).
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { VERTICALS } from "@/shared/types/database";

export interface ClosedLead {
  id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  preferred_language: string;
  location: string;
  estimated_value: number | null;
  status: string;
}

export async function getClosedLeads(): Promise<ClosedLead[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leads")
    .select("id, phone_number, first_name, last_name, preferred_language, location, estimated_value, status")
    .eq("status", "Closed");
  if (error) throw error;
  return (data ?? []) as ClosedLead[];
}

/** NOAA/NWS active alerts for Florida (Collier in FL). Zone FLZ061 = Collier County. */
const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?area=FL";

export interface WeatherAlert {
  event: string;
  headline: string;
  description: string;
  severity: string;
  areaDesc: string;
}

export async function fetchNOAAAlerts(): Promise<WeatherAlert[]> {
  const res = await fetch(NWS_ALERTS_URL, {
    headers: { Accept: "application/geo+json", "User-Agent": "Ziarem/1.0" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: Array<{ properties?: { event?: string; headline?: string; description?: string; severity?: string; areaDesc?: string } }> };
  const features = data?.features ?? [];
  return features
    .map((f) => f.properties)
    .filter(Boolean)
    .map((p) => ({
      event: p!.event ?? "",
      headline: p!.headline ?? "",
      description: p!.description ?? "",
      severity: p!.severity ?? "",
      areaDesc: p!.areaDesc ?? "",
    }));
}

/** Fed/Treasury rate drop detection. Use Treasury Fiscal Data or custom rate API. */
export interface RateAlert {
  date: string;
  rate: number;
  change?: number;
}

const TREASURY_RATES_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/rates_of_exchange";

export async function fetchTreasuryRateAlerts(): Promise<RateAlert[]> {
  try {
    const params = new URLSearchParams({
      format: "json",
      fields: "record_date,exchange_rate",
      filter: "currency:eq:Euro",
      sort: "record_date:desc",
      page_size: "10",
    });
    const res = await fetch(`${TREASURY_RATES_URL}?${params}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ record_date: string; exchange_rate: string }> };
    const rows = data?.data ?? [];
    const rates = rows.map((r) => ({ date: r.record_date, rate: Number(r.exchange_rate) || 0 }));
    if (rates.length < 2) return [];
    const latest = rates[0]!.rate;
    const prior = rates[1]!.rate;
    const change = prior ? latest - prior : 0;
    if (change >= 0) return [];
    return [{ date: rates[0]!.date, rate: latest, change }];
  } catch {
    return [];
  }
}

export async function fetchTreasury10Y(): Promise<{ date: string; rate: number } | null> {
  return null;
}

const COLLIER_KEYWORDS = /collier|naples|34102|34103|34104|34105|34108|34109|34110|34112|34116|34117|34119|34120/i;

export function isCollierCounty(alert: WeatherAlert): boolean {
  return COLLIER_KEYWORDS.test(alert.areaDesc) || COLLIER_KEYWORDS.test(alert.description);
}

export function isHurricaneWatch(alert: WeatherAlert): boolean {
  return /hurricane|tropical storm|watch|warning/i.test(alert.event) || /hurricane|tropical/i.test(alert.headline);
}

/** Draft hyper-personalized SMS using Gemini from lead + trigger context. */
export async function draftDigitalTwinSMS(
  lead: ClosedLead,
  trigger: { type: "weather" | "rate"; headline: string; body: string },
  geminiApiKey: string
): Promise<string> {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "there";
  const lang = lead.preferred_language === "ES" ? "Spanish" : "English";
  const prompt = `You are the Ziarem lifetime concierge. Write ONE short SMS (under 160 chars if possible) in ${lang} for ${name}.
Trigger: ${trigger.type}. ${trigger.headline}. ${trigger.body}
Past relationship: Closed lead, location ${lead.location}.
Offer a relevant cross-sell: if weather/hurricane → RENO LLC storm prep or Wolf Insurance; if rate drop → Dos Mortgage refi. Be personal, no spam. No quotes or labels.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 150 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  return text.slice(0, 320);
}

export async function sendTwilioSMS(
  to: string,
  body: string,
  twilioAccountSid: string,
  twilioAuthToken: string,
  fromNumber: string
): Promise<boolean> {
  const normalized = to.replace(/\D/g, "");
  const toE164 = normalized.length === 10 ? `+1${normalized}` : to.startsWith("+") ? to : `+${to}`;
  const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({ To: toE164, From: fromNumber, Body: body }),
  });
  return res.ok;
}

/** Run the Digital Twin cycle: fetch alerts, match Closed leads (e.g. Collier for weather), draft and send SMS. */
export async function runDigitalTwinCycle(options: {
  geminiApiKey: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
}): Promise<{ weatherSent: number; rateSent: number }> {
  const leads = await getClosedLeads();
  const [weatherAlerts, rateAlerts] = await Promise.all([fetchNOAAAlerts(), fetchTreasuryRateAlerts()]);
  const collierWeather = weatherAlerts.filter((a) => isCollierCounty(a) && isHurricaneWatch(a));
  const hasRateDrop = rateAlerts.some((r) => r.change != null && r.change < 0);

  let weatherSent = 0;
  let rateSent = 0;
  const collierLeads = leads.filter((l) => COLLIER_KEYWORDS.test(l.location));

  for (const lead of collierLeads) {
    if (collierWeather.length > 0) {
      const alert = collierWeather[0]!;
      const body = await draftDigitalTwinSMS(
        lead,
        { type: "weather", headline: alert.headline, body: alert.description?.slice(0, 200) ?? "" },
        options.geminiApiKey
      );
      if (body && (await sendTwilioSMS(lead.phone_number, body, options.twilioAccountSid, options.twilioAuthToken, options.twilioFromNumber))) {
        weatherSent++;
      }
    }
    if (hasRateDrop && rateAlerts[0]) {
      const r = rateAlerts[0];
      const body = await draftDigitalTwinSMS(
        lead,
        { type: "rate", headline: "Interest rate update", body: `Rates have moved. Consider a refi.` },
        options.geminiApiKey
      );
      if (body && (await sendTwilioSMS(lead.phone_number, body, options.twilioAccountSid, options.twilioAuthToken, options.twilioFromNumber))) {
        rateSent++;
      }
    }
  }

  return { weatherSent, rateSent };
}
