/**
 * Phase 6: Omnichannel infinite memory (RAG).
 * On prospect SMS reply: look up last voice_call interaction by phone_number,
 * pass summary as context to LLM, generate reply, and optionally send via Twilio.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const fromPhone =
      (body?.From ?? body?.from ?? body?.phone_number ?? "").toString().replace(/\D/g, "").slice(-10);
    const messageBody = (body?.Body ?? body?.body ?? body?.message ?? "").toString().trim();

    if (!fromPhone || fromPhone.length < 10) {
      return NextResponse.json(
        { error: "Missing or invalid From/phone_number" },
        { status: 400 }
      );
    }

    const { data: lastVoice } = await supabaseAdmin
      .from("interactions")
      .select("id, summary, transcript, payload")
      .eq("phone_number", fromPhone.padStart(10, "0"))
      .eq("type", "voice_call")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const contextSummary = lastVoice?.summary ?? lastVoice?.transcript?.slice(0, 500) ?? "No prior call context.";
    const geminiKey = process.env.GEMINI_API_KEY;
    let replyText = "Thanks for your message. A team member will follow up shortly.";

    if (geminiKey && messageBody) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `You are ziarem.com SMS reply assistant. Context from this prospect's last AI phone call:\n\n${contextSummary}\n\nProspect just sent this SMS: "${messageBody}"\n\nReply in one short, professional SMS (under 160 chars if possible). Same language as the prospect's message. Do not add quotes or labels.`,
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0.4, maxOutputTokens: 150 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const part = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (part) replyText = part.trim().slice(0, 320);
      }
    }

    await supabaseAdmin.from("interactions").insert({
      type: "inbound_sms",
      phone_number: fromPhone.padStart(10, "0"),
      transcript: messageBody,
      summary: null,
      payload: body ?? {},
    });

    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    if (twilioAccountSid && twilioAuthToken && twilioFrom) {
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
          },
          body: new URLSearchParams({
            To: `+1${fromPhone}`,
            From: twilioFrom,
            Body: replyText,
          }),
        }
      );
    }

    return NextResponse.json({
      ok: true,
      context_used: !!lastVoice,
      reply: replyText,
    });
  } catch (e) {
    console.error("[inbound-sms]", e);
    return NextResponse.json(
      { error: "SMS handling failed", detail: String(e) },
      { status: 500 }
    );
  }
}
