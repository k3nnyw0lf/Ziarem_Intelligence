/**
 * Ziarem.com call-end webhook: ingestion endpoint for telephony provider (Vapi/Retell).
 * POST /api/webhooks/call-end
 * Body: transcript (required), recordingUrl/recording_url optional, phone_number/phone optional.
 *
 * Pipeline: Gemini extraction → Supabase upsert (leads, calls) → cross-sell execution → n8n onboarding webhook.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFromTranscript } from "@/lib/gemini/extract";
import { calculateRevenue, VERTICALS } from "@/lib/call-end/revenue";
import { executeCrossSells } from "@/lib/call-end/cross-sell";
import { triggerN8nOnboarding } from "@/lib/call-end/n8n";

/** Allowed lead statuses (directive). */
const LEAD_STATUSES = ["Cold", "Qualified", "Under Contract", "Closed"] as const;

function normalizeLeadStatus(s: string | undefined): (typeof LEAD_STATUSES)[number] {
  if (!s) return "Cold";
  const lower = s.toLowerCase().replace(/\s+/g, " ");
  for (const status of LEAD_STATUSES) {
    if (status.toLowerCase() === lower) return status;
  }
  if (lower.includes("contract")) return "Under Contract";
  if (lower.includes("qualif") || lower.includes("interest")) return "Qualified";
  if (lower.includes("closed") || lower.includes("won")) return "Closed";
  return "Cold";
}

function getTranscript(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const t = o.transcript ?? (o.message as Record<string, unknown>)?.transcript;
  if (typeof t === "string" && t.trim()) return t.trim();
  return null;
}

function getRecordingUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const u = o.recordingUrl ?? o.recording_url ?? (o.call as Record<string, unknown>)?.recordingUrl;
  if (typeof u === "string" && u.trim()) return u.trim();
  return null;
}

function getPhone(body: unknown, extracted: { phone_number?: string }): string | null {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const raw = o.phone_number ?? o.phone ?? extracted.phone_number;
    if (typeof raw === "string" && raw.trim()) {
      const digits = raw.trim().replace(/\D/g, "").slice(-10);
      if (digits.length >= 10) return digits.padStart(10, "0");
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const transcript = getTranscript(body);
    if (!transcript) {
      return NextResponse.json(
        { error: "Missing transcript in payload" },
        { status: 400 }
      );
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return NextResponse.json(
        { error: "Server misconfiguration: GEMINI_API_KEY not set" },
        { status: 500 }
      );
    }

    const extracted = await extractFromTranscript(transcript, geminiKey);
    const phone = getPhone(body, extracted);
    if (!phone) {
      return NextResponse.json(
        {
          error:
            "Could not determine phone_number. Send phone_number or phone in body, or ensure transcript mentions it.",
        },
        { status: 400 }
      );
    }

    const preferredLanguage = extracted.preferred_language === "ES" ? "ES" : "EN";
    const status = normalizeLeadStatus(extracted.status);
    const location = extracted.location ?? "Naples, Florida";
    const estimatedValue =
      extracted.estimated_loan_amount ?? extracted.estimated_home_value ?? null;
    const primaryVertical = extracted.primary_vertical ?? VERTICALS.RE4LTY;

    const { data: companies, error: companiesErr } = await supabaseAdmin
      .from("companies")
      .select("id, vertical")
      .eq("active_status", true);
    if (companiesErr || !companies?.length) {
      return NextResponse.json(
        { error: "Companies not found", detail: companiesErr?.message },
        { status: 500 }
      );
    }
    const verticalToId = new Map(companies.map((c) => [c.vertical, c.id]));
    const companyId = verticalToId.get(primaryVertical) ?? companies[0].id;

    // Root lead: unique on (phone_number) where parent_lead_id IS NULL; upsert via select then update/insert
    const { data: existing } = await supabaseAdmin
      .from("leads")
      .select("id, phone_number, first_name, last_name, preferred_language, location, estimated_value")
      .eq("phone_number", phone)
      .is("parent_lead_id", null)
      .maybeSingle();

    const leadPayload = {
      phone_number: phone,
      first_name: extracted.first_name ?? null,
      last_name: extracted.last_name ?? null,
      preferred_language: preferredLanguage,
      location,
      estimated_value: estimatedValue,
      status,
      updated_at: new Date().toISOString(),
    };

    let leadRow: { id: string; phone_number: string; first_name: string | null; last_name: string | null; preferred_language: string; location: string; estimated_value: number | null };
    if (existing) {
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from("leads")
        .update(leadPayload)
        .eq("id", existing.id)
        .select("id, phone_number, first_name, last_name, preferred_language, location, estimated_value")
        .single();
      if (updateErr || !updated) {
        return NextResponse.json(
          { error: "Lead update failed", detail: updateErr?.message },
          { status: 500 }
        );
      }
      leadRow = updated;
    } else {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("leads")
        .insert(leadPayload)
        .select("id, phone_number, first_name, last_name, preferred_language, location, estimated_value")
        .single();
      if (insertErr || !inserted) {
        return NextResponse.json(
          { error: "Lead insert failed", detail: insertErr?.message },
          { status: 500 }
        );
      }
      leadRow = inserted;
    }
    const leadId = leadRow.id;
    const parentLead = {
      id: leadId,
      phone_number: leadRow.phone_number,
      first_name: leadRow.first_name,
      last_name: leadRow.last_name,
      preferred_language: leadRow.preferred_language,
      location: leadRow.location,
      estimated_value: leadRow.estimated_value,
    };

    const calculatedRevenue = calculateRevenue(primaryVertical, extracted);

    const { data: callRow, error: callErr } = await supabaseAdmin
      .from("calls")
      .insert({
        lead_id: leadId,
        company_id: companyId,
        transcript,
        recording_url: getRecordingUrl(body),
        extracted_data: extracted as Record<string, unknown>,
        calculated_revenue: calculatedRevenue,
      })
      .select("id")
      .single();

    if (callErr || !callRow) {
      return NextResponse.json(
        { error: "Call insert failed", detail: callErr?.message },
        { status: 500 }
      );
    }

    const crossSellTriggered = await executeCrossSells(
      parentLead,
      primaryVertical,
      extracted.status
    );

    await triggerN8nOnboarding({
      lead_id: leadId,
      lead_phone: phone,
      lead_first_name: extracted.first_name ?? undefined,
      lead_last_name: extracted.last_name ?? undefined,
      preferred_language: preferredLanguage,
      vertical: primaryVertical,
      cross_sell_triggered: crossSellTriggered,
      triggered_at: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      lead_id: leadId,
      call_id: callRow.id,
      company_id: companyId,
      primary_vertical: primaryVertical,
      calculated_revenue: calculatedRevenue,
      cross_sell_triggered: crossSellTriggered,
    });
  } catch (e) {
    console.error("[call-end webhook]", e);
    return NextResponse.json(
      { error: "Internal server error", detail: String(e) },
      { status: 500 }
    );
  }
}
