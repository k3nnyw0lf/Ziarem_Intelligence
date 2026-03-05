/**
 * Phase 6: Predictive Whale lead scoring.
 * Run daily (cron). Analyzes historical conversion data in calls and assigns
 * propensity_score (1-99) to cold leads. Vapi outbound should query:
 * SELECT * FROM leads WHERE status = 'Cold' ORDER BY propensity_score DESC NULLS LAST LIMIT 50
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: calls, error: callsErr } = await supabaseAdmin
      .from("calls")
      .select("lead_id, extracted_data, calculated_revenue")
      .not("extracted_data", "is", null);

    if (callsErr) {
      return NextResponse.json(
        { error: "Calls fetch failed", detail: callsErr.message },
        { status: 500 }
      );
    }

    const leadMetrics = new Map<
      string,
      { callCount: number; totalRevenue: number; hasHighIntent: number }
    >();

    for (const c of calls ?? []) {
      const lid = c.lead_id as string;
      const ext = (c.extracted_data as Record<string, unknown>) ?? {};
      const revenue = Number(c.calculated_revenue ?? 0);
      const highIntent =
        ext.status === "Under Contract" ||
        ext.status === "Closed" ||
        (ext as { high_intent_to_close?: boolean }).high_intent_to_close === true
          ? 1
          : 0;

      const cur = leadMetrics.get(lid) ?? {
        callCount: 0,
        totalRevenue: 0,
        hasHighIntent: 0,
      };
      leadMetrics.set(lid, {
        callCount: cur.callCount + 1,
        totalRevenue: cur.totalRevenue + revenue,
        hasHighIntent: cur.hasHighIntent + highIntent,
      });
    }

    const { data: coldLeads, error: leadsErr } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("status", "Cold")
      .is("parent_lead_id", null);

    if (leadsErr) {
      return NextResponse.json(
        { error: "Leads fetch failed", detail: leadsErr.message },
        { status: 500 }
      );
    }

    const scored = (coldLeads ?? []).map((lead) => {
      const m = leadMetrics.get(lead.id) ?? {
        callCount: 0,
        totalRevenue: 0,
        hasHighIntent: 0,
      };
      let score = 50;
      if (m.callCount > 0) score += Math.min(20, m.callCount * 5);
      if (m.totalRevenue > 0) score += Math.min(20, Math.floor(m.totalRevenue / 500));
      if (m.hasHighIntent > 0) score += 15;
      score = Math.max(1, Math.min(99, score));
      return { id: lead.id, propensity_score: score };
    });

    for (const { id, propensity_score } of scored) {
      await supabaseAdmin
        .from("leads")
        .update({ propensity_score, updated_at: new Date().toISOString() })
        .eq("id", id);
    }

    return NextResponse.json({
      ok: true,
      updated: scored.length,
      message:
        "Vapi outbound cron should use: SELECT * FROM leads WHERE status = 'Cold' ORDER BY propensity_score DESC NULLS LAST LIMIT 50",
    });
  } catch (e) {
    console.error("[score-leads]", e);
    return NextResponse.json(
      { error: "Score job failed", detail: String(e) },
      { status: 500 }
    );
  }
}
