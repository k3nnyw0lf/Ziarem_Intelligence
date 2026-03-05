/**
 * Phase 9: Real-Time Generative Vision (RENO LLC / Re4lty).
 * Receives property address + desired style (e.g. "modern kitchen"); fetches property image,
 * applies style via image-generation API, SMS the resulting image URL to the prospect.
 * Call from Vapi (generate_vision_render tool) or n8n.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const IMAGE_API_URL = process.env.VISION_RENDER_IMAGE_API_URL;

interface VisionPayload {
  property_address?: string;
  desired_style?: string;
  prospect_phone?: string;
  lead_id?: string;
}

async function fetchPropertyImageUrl(address: string): Promise<string | null> {
  if (IMAGE_API_URL) {
    const res = await fetch(IMAGE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { image_url?: string };
      return data.image_url ?? null;
    }
  }
  return null;
}

/** Optional: call external image-generation API (Replicate, Stability, etc.) — set VISION_RENDER_IMAGE_API_URL to a service that accepts { address, style } and returns { image_url }. */
async function generateStyleImageUrl(address: string, style: string): Promise<string | null> {
  const apiUrl = process.env.VISION_RENDER_STYLE_API_URL;
  if (!apiUrl) return null;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, style }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { image_url?: string };
    return data.image_url ?? null;
  } catch {
    return null;
  }
}

async function sendTwilioSMS(to: string, body: string, mediaUrl?: string): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return false;
  const normalized = to.replace(/\D/g, "");
  const toE164 = normalized.length === 10 ? `+1${normalized}` : to.startsWith("+") ? to : `+${to}`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const form = new URLSearchParams({ To: toE164, From: TWILIO_FROM, Body: body });
  if (mediaUrl && mediaUrl.startsWith("http")) form.set("MediaUrl", mediaUrl);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
    body: form.toString(),
  });
  return res.ok;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as VisionPayload;
    const args = body.arguments ?? body;
    const address = (args.property_address ?? args.address ?? "").toString().trim();
    const style = (args.desired_style ?? args.style ?? "").toString().trim();
    const phone = (args.prospect_phone ?? args.phone ?? "").toString().trim();

    if (!address || !style || !phone) {
      return NextResponse.json(
        { error: "property_address, desired_style, and prospect_phone required" },
        { status: 400 }
      );
    }

    const propertyImageUrl = await fetchPropertyImageUrl(address);
    const styleImageUrl = await generateStyleImageUrl(address, style);
    const imageUrlToSend = propertyImageUrl ?? styleImageUrl ?? undefined;
    const messageBody = imageUrlToSend
      ? `Here’s a quick visual of ${style} for ${address}: ${imageUrlToSend}`
      : `We’re preparing a ${style} visual for ${address}. Our team will send the render shortly.`;

    const sent = await sendTwilioSMS(phone, messageBody, imageUrlToSend);

    if (args.lead_id) {
      const supabase = getSupabaseAdmin();
      await supabase.from("interactions").insert({
        type: "vision_render",
        lead_id: args.lead_id,
        phone_number: phone.replace(/\D/g, "").slice(-10),
        summary: `Vision render: ${style} for ${address}`,
        payload: { address, style, sent, has_media: Boolean(imageUrlToSend) },
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      sent,
      message: sent ? "SMS sent with image or link" : "SMS not sent (check Twilio env)",
    });
  } catch (e) {
    console.error("[vision-render]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
