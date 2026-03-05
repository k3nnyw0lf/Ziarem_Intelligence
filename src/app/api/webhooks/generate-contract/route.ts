/**
 * Phase 6: Autonomous contract generation.
 * When Gemini extraction has high_intent_to_close: true, format payload,
 * call PandaDoc/DocuSign to create a bilingual service agreement, then
 * send the signing URL via Twilio SMS.
 */

import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const extracted = body?.extracted_data ?? body?.extracted ?? body;
    const highIntent =
      extracted?.high_intent_to_close === true ||
      extracted?.high_intent_to_close === "true";

    if (!highIntent) {
      return NextResponse.json(
        { ok: false, reason: "high_intent_to_close not true" },
        { status: 200 }
      );
    }

    const leadId = body?.lead_id ?? extracted?.lead_id;
    const phone =
      body?.phone_number ?? body?.phone ?? extracted?.phone_number;
    const preferredLanguage =
      extracted?.preferred_language === "ES" ? "ES" : "EN";

    if (!phone) {
      return NextResponse.json(
        { error: "Missing phone_number for SMS" },
        { status: 400 }
      );
    }

    const payload = {
      lead_id: leadId,
      first_name: extracted?.first_name,
      last_name: extracted?.last_name,
      preferred_language: preferredLanguage,
      estimated_loan_amount: extracted?.estimated_loan_amount,
      estimated_home_value: extracted?.estimated_home_value,
      primary_vertical: extracted?.primary_vertical,
    };

    const docuSignUrl = process.env.DOCUSIGN_API_URL ?? process.env.PANDADOC_API_URL;
    const docuSignKey = process.env.DOCUSIGN_API_KEY ?? process.env.PANDADOC_API_KEY;
    let signingUrl: string | null = null;

    if (docuSignUrl && docuSignKey) {
      const res = await fetch(docuSignUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${docuSignKey}`,
        },
        body: JSON.stringify({
          ...payload,
          language: preferredLanguage,
          document_type: "service_agreement",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        signingUrl = data?.signing_url ?? data?.envelope_uri ?? data?.url ?? null;
      }
    }

    if (!signingUrl) {
      signingUrl =
        process.env.PLACEHOLDER_SIGNING_URL ??
        "https://ziarem.com/sign?token=placeholder";
    }

    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

    if (twilioAccountSid && twilioAuthToken && twilioFrom) {
      const to = phone.replace(/\D/g, "").slice(-10);
      const toE164 = to.length === 10 ? `+1${to}` : `+${to}`;
      const message =
        preferredLanguage === "ES"
          ? `Ziarem: Su acuerdo de servicios está listo. Firma aquí: ${signingUrl}`
          : `Ziarem: Your service agreement is ready. Sign here: ${signingUrl}`;

      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
          },
          body: new URLSearchParams({
            To: toE164,
            From: twilioFrom,
            Body: message,
          }),
        }
      );
    }

    return NextResponse.json({
      ok: true,
      high_intent_to_close: true,
      signing_url_sent: !!signingUrl,
      sms_sent: !!(twilioAccountSid && twilioAuthToken && twilioFrom),
    });
  } catch (e) {
    console.error("[generate-contract]", e);
    return NextResponse.json(
      { error: "Contract generation failed", detail: String(e) },
      { status: 500 }
    );
  }
}
