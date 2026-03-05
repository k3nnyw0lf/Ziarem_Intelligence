/**
 * Phase 7: When the prospect focuses the live portal page, we set is_viewing in the DB
 * (handled by the client) and call this API. If the portal has a Vapi call_id, we notify
 * Vapi so the AI can acknowledge: "I see you have the page open..."
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const VAPI_CONTROL_BASE =
  process.env.VAPI_CONTROL_BASE_URL ?? "https://api.vapi.ai";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const portalId = (body.portal_id ?? body.portalId) as string | undefined;
    if (!portalId?.trim()) {
      return NextResponse.json(
        { error: "portal_id is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: portal, error: fetchError } = await supabase
      .from("live_portals")
      .select("id, call_id")
      .eq("id", portalId.trim())
      .single();

    if (fetchError || !portal?.call_id) {
      return NextResponse.json({ ok: true, notified: false });
    }

    const apiKey = process.env.VAPI_PRIVATE_KEY ?? process.env.VAPI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: true, notified: false });
    }

    const controlUrl = `${VAPI_CONTROL_BASE}/call/${portal.call_id}/control`;
    const res = await fetch(controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        type: "add-message",
        message: {
          role: "system",
          content: "prospect_is_viewing",
        },
        triggerResponseEnabled: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn("[prospect-viewing] Vapi control failed:", res.status, text);
      return NextResponse.json({ ok: true, notified: false });
    }

    return NextResponse.json({ ok: true, notified: true });
  } catch (e) {
    console.error("[prospect-viewing]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
