/**
 * Phase 7: Vapi tool endpoint for generate_live_canvas.
 * Vapi calls this when the AI triggers the tool; we create/update a live_portals row and return the prospect URL.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { VERTICALS } from "@/shared/types/database";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

interface ToolPayload {
  lead_id?: string;
  estimated_home_value?: number;
  wants_reno?: boolean;
  wants_insurance?: boolean;
  wants_mortgage?: boolean;
  wants_laenan?: boolean;
  renovation_budget?: number;
  loan_amount?: number;
}

function buildActiveVerticals(p: ToolPayload): string[] {
  const v: string[] = [];
  if (p.wants_mortgage) v.push(VERTICALS.DOS_MORTGAGE);
  if (p.wants_laenan) v.push(VERTICALS.LAENAN);
  if (p.wants_reno) v.push(VERTICALS.RENO);
  if (p.wants_insurance) v.push(VERTICALS.WOLF_INSURANCE);
  return v;
}

function buildDynamicMath(p: ToolPayload): Record<string, unknown> {
  const home = p.estimated_home_value ?? 0;
  const reno = p.renovation_budget ?? 0;
  const loan = p.loan_amount ?? home + reno;
  const originationRate = 0.0275;
  const originationFee = Math.round(loan * originationRate);
  const totalLoan = loan + (p.wants_mortgage ? originationFee : 0);
  return {
    estimated_home_value: home,
    renovation_budget: reno,
    loan_amount: loan,
    origination_fee_percent: 2.75,
    origination_fee: originationFee,
    total_loan_with_origination: totalLoan,
    laenan_processing_fee: 1000,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const args = (body.arguments ?? body) as ToolPayload & { call_id?: string };
    const leadId = args.lead_id?.trim();
    const callId = typeof args.call_id === "string" ? args.call_id.trim() : undefined;
    if (!leadId) {
      return NextResponse.json(
        { error: "lead_id is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const active_verticals = buildActiveVerticals(args);
    const dynamic_math = buildDynamicMath(args);

    const { data: row, error } = await supabase
      .from("live_portals")
      .insert({
        lead_id: leadId,
        active_verticals,
        dynamic_math,
        is_viewing: false,
        ...(callId && { call_id: callId }),
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "lead_id not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const portalId = row?.id;
    if (!portalId) {
      return NextResponse.json({ error: "No portal id returned" }, { status: 500 });
    }
    const url = `${BASE_URL}/live/${portalId}`;
    return NextResponse.json({ url, portal_id: portalId });
  } catch (e) {
    console.error("[vapi-live-canvas]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
