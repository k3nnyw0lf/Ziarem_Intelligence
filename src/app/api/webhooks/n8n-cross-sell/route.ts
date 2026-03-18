/**
 * Ziarem Enterprise: n8n webhook for cross-sell workflow.
 * POST /api/webhooks/n8n-cross-sell
 * Receives callbacks from n8n (e.g. status updates, triggers). Bilingual (EN/ES) payloads supported.
 *
 * Example body: { action: "update_status", cross_sell_id: "uuid", status: "Automated_Outreach" | "Closed" }
 * Or: { action: "ping" } for health check.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "ping";

    if (action === "ping") {
      return NextResponse.json({ ok: true, service: "n8n-cross-sell" });
    }

    if (action === "update_status") {
      const crossSellId = body.cross_sell_id;
      const status = body.status;
      if (!crossSellId || !["Pending", "Automated_Outreach", "Closed"].includes(status)) {
        return NextResponse.json(
          { error: "Invalid cross_sell_id or status (use Pending, Automated_Outreach, Closed)" },
          { status: 400 }
        );
      }
      const { data, error } = await supabaseAdmin
        .from("cross_sells")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", crossSellId)
        .select("id")
        .single();
      if (error) {
        return NextResponse.json(
          { error: "Update failed", detail: error.message },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, updated: data });
    }

    return NextResponse.json(
      { error: "Unknown action", supported: ["ping", "update_status"] },
      { status: 400 }
    );
  } catch (e) {
    console.error("[n8n-cross-sell]", e);
    return NextResponse.json(
      { error: "Internal server error", detail: String(e) },
      { status: 500 }
    );
  }
}
