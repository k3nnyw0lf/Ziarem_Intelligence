/**
 * Phase 8: Voice-Operated Executive CRM.
 * Twilio inbound webhook — only allow Ken's verified cell. Returns TwiML: pipeline briefing + voice command handling.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { VERTICALS } from "@/shared/types/database";

const EXECUTIVE_CALLER_ID = process.env.EXECUTIVE_ALLOWED_CALLER_ID ?? process.env.KEN_PHONE_NUMBER ?? "";

function normalizePhone(from: string): string {
  return from.replace(/\D/g, "").slice(-10);
}

function isAllowedCaller(from: string): boolean {
  if (!EXECUTIVE_CALLER_ID.trim()) return false;
  const allowed = normalizePhone(EXECUTIVE_CALLER_ID);
  const caller = normalizePhone(from);
  return allowed.length >= 10 && caller.length >= 10 && caller === allowed;
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return new Response("Bad Request", { status: 400 });
  }

  const from = (form.get("From") ?? form.get("Caller") ?? "").toString();
  if (!isAllowedCaller(from)) {
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>',
      { status: 200, headers: { "Content-Type": "application/xml" } }
    );
  }

  const supabase = getSupabaseAdmin();
  const since = new Date();
  since.setDate(since.getDate() - 1);

  const { data: calls } = await supabase
    .from("calls")
    .select("id, company_id, calculated_revenue, created_at")
    .gte("created_at", since.toISOString());

  const { data: companies } = await supabase
    .from("companies")
    .select("id, vertical");

  const verticalToName = new Map((companies ?? []).map((c) => [c.id, c.vertical]));
  const byVertical: Record<string, number> = {};
  let totalPipeline = 0;
  for (const c of calls ?? []) {
    const vert = verticalToName.get(c.company_id) ?? "Other";
    const rev = Number(c.calculated_revenue) || 0;
    byVertical[vert] = (byVertical[vert] ?? 0) + rev;
    totalPipeline += rev;
  }

  const re4lty = byVertical[VERTICALS.RE4LTY] ?? 0;
  const wolf = byVertical[VERTICALS.WOLF_INSURANCE] ?? 0;
  const dos = byVertical[VERTICALS.DOS_MORTGAGE] ?? 0;
  const reno = byVertical[VERTICALS.RENO] ?? 0;
  const laenan = byVertical[VERTICALS.LAENAN] ?? 0;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const actionUrl = `${baseUrl}/api/webhooks/executive-command`;

  const say =
    `Executive briefing. Overnight gross pipeline value: $${totalPipeline.toLocaleString()}. ` +
    `Re4lty Inc: $${re4lty.toLocaleString()}. Wolf Insurance: $${wolf.toLocaleString()}. Dos Mortgage: $${dos.toLocaleString()}. ` +
    (reno > 0 ? `RENO LLC: $${reno.toLocaleString()}. ` : "") +
    (laenan > 0 ? `Laenan: $${laenan.toLocaleString()}. ` : "") +
    `You can say: Pause the RENO LLC campaign, or Send the Laenan processing links to the hot leads.`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeXml(say)}</Say>
  <Gather input="speech" action="${escapeXml(actionUrl)}" speechTimeout="auto" speechModel="numbers_and_commands" timeout="3">
    <Say voice="alice">What would you like to do?</Say>
  </Gather>
  <Say voice="alice">Goodbye.</Say>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
