/**
 * Phase 9: Digital Twin Cron — query Closed leads, NOAA + Treasury triggers, draft SMS via Gemini, send via Twilio.
 * Call from n8n Cron or Vercel Cron (e.g. every 6h). Secure with CRON_SECRET.
 */

import { NextResponse } from "next/server";
import { runDigitalTwinCycle } from "@/lib/agents/digital-twin";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gemini = process.env.GEMINI_API_KEY;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

  if (!gemini || !twilioSid || !twilioToken || !twilioFrom) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY or Twilio env" },
      { status: 500 }
    );
  }

  try {
    const result = await runDigitalTwinCycle({
      geminiApiKey: gemini,
      twilioAccountSid: twilioSid,
      twilioAuthToken: twilioToken,
      twilioFromNumber: twilioFrom,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[digital-twin cron]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
