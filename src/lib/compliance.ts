/**
 * Florida TCPA / Mini-TCPA guardrails for ziarem.com.
 * Run before dispatching a call: time-zone fence (America/New_York 8am–8pm) and
 * frequency cap (max 3 calls per phone in 24 hours).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const TIMEZONE = "America/New_York";
const START_HOUR = 8; // 8:00 AM
const END_HOUR = 20; // 8:00 PM (exclusive: allow up to 19:59:59)
const MAX_CALLS_PER_24H = 3;

export type ComplianceBlockReason = "time_zone_fence" | "frequency_cap";

function normalizePhone(phoneNumber: string): string {
  const digits = phoneNumber.trim().replace(/\D/g, "").slice(-10);
  return digits.length >= 10 ? digits.padStart(10, "0") : "";
}

/**
 * Time-zone fence: current time in America/New_York must be strictly between
 * 8:00 AM and 8:00 PM (i.e. >= 8:00 AM and < 8:00 PM).
 */
function isWithinCallingHours(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const minuteOfDay = hour * 60 + minute;
  const startMinute = START_HOUR * 60;
  const endMinute = END_HOUR * 60;
  return minuteOfDay >= startMinute && minuteOfDay < endMinute;
}

/**
 * Frequency cap: this phone must have been called fewer than 3 times in the past 24 hours.
 * Counts calls via leads.phone_number.
 */
/**
 * Count calls to this phone in the past 24 hours (via leads.phone_number).
 */
async function getCallCountLast24Hours(phoneNumber: string): Promise<number> {
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("phone_number", phoneNumber);
  const leadIds = (leads ?? []).map((l) => l.id);
  if (leadIds.length === 0) return 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("calls")
    .select("id", { count: "exact", head: true })
    .in("lead_id", leadIds)
    .gte("created_at", since);

  if (error) {
    console.error("[compliance] frequency cap query failed:", error);
    return MAX_CALLS_PER_24H; // fail closed: assume at cap
  }
  return count ?? 0;
}

async function logComplianceBlock(
  phoneNumber: string,
  reason: ComplianceBlockReason
): Promise<void> {
  try {
    await supabaseAdmin.from("compliance_blocks").insert({
      phone_number: phoneNumber,
      reason,
    });
  } catch (e) {
    console.error("[compliance] failed to log block:", e);
  }
}

/**
 * Returns true only if both checks pass: (1) current time in America/New_York
 * is between 8:00 AM and 8:00 PM, and (2) this phone has been called fewer than
 * 3 times in the past 24 hours. Otherwise returns false and logs the block.
 */
export async function canDialLead(phoneNumber: string): Promise<boolean> {
  const phone = normalizePhone(phoneNumber);
  if (!phone) {
    return false;
  }

  if (!isWithinCallingHours()) {
    await logComplianceBlock(phone, "time_zone_fence");
    return false;
  }

  const count = await getCallCountLast24Hours(phone);
  if (count >= MAX_CALLS_PER_24H) {
    await logComplianceBlock(phone, "frequency_cap");
    return false;
  }

  return true;
}
