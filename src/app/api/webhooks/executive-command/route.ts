/**
 * Phase 8: Executive voice command handler.
 * Receives Twilio Gather (speech) result; interprets "Pause RENO LLC campaign", "Send Laenan links to hot leads", etc.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return twimlResponse("<Say>Sorry, I didn't get that.</Say>");
  }

  const speech = (form.get("SpeechResult") ?? form.get("UnstableSpeechResult") ?? "").toString().trim().toLowerCase();

  if (!speech) {
    return twimlResponse("<Say>No command heard. Goodbye.</Say>");
  }

  const supabase = getSupabaseAdmin();
  let said = "Done.";

  if (speech.includes("pause") && (speech.includes("reno") || speech.includes("renault"))) {
    await supabase.from("companies").update({ active_status: false }).eq("vertical", "RENO LLC").then(() => {});
    said = "RENO LLC campaign paused.";
  } else if (speech.includes("resume") && (speech.includes("reno") || speech.includes("renault"))) {
    await supabase.from("companies").update({ active_status: true }).eq("vertical", "RENO LLC").then(() => {});
    said = "RENO LLC campaign resumed.";
  } else if (
    (speech.includes("send") || speech.includes("laenan")) &&
    (speech.includes("link") || speech.includes("processing") || speech.includes("hot") || speech.includes("lead"))
  ) {
    const { data: hot } = await supabase
      .from("leads")
      .select("id, phone_number")
      .in("status", ["Qualified", "Under Contract"])
      .not("company_id", "is", null)
      .limit(50);
    if (hot?.length) {
      const webhook = process.env.N8N_LAENAN_LINKS_WEBHOOK_URL;
      if (webhook) {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_ids: hot.map((l) => l.id), phone_numbers: hot.map((l) => l.phone_number) }),
        }).catch(() => {});
      }
      said = `Triggering Laenan processing links for ${hot.length} hot leads. They will receive the link by text shortly.`;
    } else {
      said = "No hot leads in the pipeline right now.";
    }
  }

  return twimlResponse(`<Say voice="alice">${escapeXml(said)}</Say><Say voice="alice">Anything else? Goodbye.</Say>`);
}

function twimlResponse(inner: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
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
