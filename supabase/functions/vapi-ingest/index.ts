/**
 * Vapi webhook ingestion + Gemini extraction + DB upsert + cross-sell routing.
 * Low-latency Supabase Edge Function; use GEMINI_API_KEY and service role in env.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERTICALS = {
  RE4LTY: "Re4lty Inc.",
  RENO: "RENO LLC",
  DOS_MORTGAGE: "Dos Mortgage LLC",
  LAENAN: "Laenan",
  CLOSED_BY_WHOM: "Closed By Whom?",
  WOLF_INSURANCE: "Wolf Insurance",
} as const;

const RE4LTY_CROSS_SELL_VERTICALS = [
  VERTICALS.DOS_MORTGAGE,
  VERTICALS.LAENAN,
  VERTICALS.CLOSED_BY_WHOM,
  VERTICALS.WOLF_INSURANCE,
];

const RENO_CROSS_SELL_VERTICALS = [VERTICALS.WOLF_INSURANCE];

interface ExtractedData {
  lead_intent?: string;
  primary_vertical?: string;
  preferred_language?: "EN" | "ES";
  estimated_home_value?: number;
  estimated_loan_amount?: number;
  first_name?: string;
  last_name?: string;
  location?: string;
  status?: string;
  phone_number?: string;
  [key: string]: unknown;
}

function getTranscript(body: Record<string, unknown>): string | null {
  const t = body.transcript ?? body.message?.transcript;
  if (typeof t === "string" && t.trim()) return t.trim();
  return null;
}

function getRecordingUrl(body: Record<string, unknown>): string | null {
  const u =
    body.recordingUrl ??
    body.recording_url ??
    body.call?.recordingUrl;
  if (typeof u === "string" && u.trim()) return u.trim();
  return null;
}

async function extractWithGemini(
  transcript: string,
  apiKey: string
): Promise<ExtractedData> {
  const prompt = `You are a data extraction system for a bilingual (English/Spanish) AI call center.
From the following call transcript, extract structured data and return ONLY a single JSON object with no markdown or explanation.
Use these exact keys where applicable: lead_intent, primary_vertical, preferred_language (EN or ES only), estimated_home_value (number), estimated_loan_amount (number), first_name, last_name, location, status, phone_number (if mentioned).
Map primary_vertical to one of: "Re4lty Inc.", "RENO LLC", "Dos Mortgage LLC", "Laenan", "Closed By Whom?", "Wolf Insurance" based on intent.
For status use values like: New, Interested, Under Contract, Closed, Not Interested, or similar.
Default location to "Naples, Florida" if not stated.
Transcript:\n\n${transcript}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";
  return JSON.parse(text) as ExtractedData;
}

function calculateRevenue(vertical: string, extracted: ExtractedData): number | null {
  const loan = extracted.estimated_loan_amount ?? extracted.estimated_home_value;
  switch (vertical) {
    case VERTICALS.DOS_MORTGAGE:
      return loan != null ? (loan * 0.0275) : null;
    case VERTICALS.LAENAN:
      return 1000;
    case VERTICALS.CLOSED_BY_WHOM:
      return 1500;
    case VERTICALS.WOLF_INSURANCE:
      return 600;
    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase configuration" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!geminiKey) {
    return new Response(
      JSON.stringify({ error: "Missing GEMINI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const transcript = getTranscript(body);
  if (!transcript) {
    return new Response(
      JSON.stringify({ error: "Missing transcript in payload" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const recordingUrl = getRecordingUrl(body);
  let extracted: ExtractedData;
  try {
    extracted = await extractWithGemini(transcript, geminiKey);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Extraction failed", detail: String(e) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const lang =
    extracted.preferred_language === "ES" ? "ES" : "EN";
  const rawPhone =
    (typeof body.phone_number === "string" && body.phone_number.trim()) ||
    (typeof body.phone === "string" && body.phone.trim()) ||
    (typeof extracted.phone_number === "string" && extracted.phone_number.trim());
  const phone = rawPhone
    ? String(rawPhone).trim().replace(/\D/g, "").slice(-10)
    : null;
  if (!phone || phone.length < 10) {
    return new Response(
      JSON.stringify({
        error: "Could not determine phone_number from transcript or payload (send phone_number or phone in body, or ensure transcript mentions it)",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const estimatedValue =
    extracted.estimated_loan_amount ??
    extracted.estimated_home_value ??
    null;
  const status = extracted.status ?? "New";
  const location = extracted.location ?? "Naples, Florida";

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: companies, error: companiesErr } = await supabase
    .from("companies")
    .select("id, vertical")
    .eq("active_status", true);
  if (companiesErr || !companies?.length) {
    return new Response(
      JSON.stringify({ error: "Companies not found", detail: companiesErr?.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  const verticalToId = new Map(companies.map((c) => [c.vertical, c.id]));

  const primaryVertical = extracted.primary_vertical ?? VERTICALS.RE4LTY;
  const companyId = verticalToId.get(primaryVertical) ?? companies[0].id;

  const { data: leadRow, error: upsertLeadErr } = await supabase
    .from("leads")
    .upsert(
      {
        phone_number: phone.padStart(10, "0"),
        first_name: extracted.first_name ?? null,
        last_name: extracted.last_name ?? null,
        preferred_language: lang,
        location,
        estimated_value: estimatedValue,
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  if (upsertLeadErr || !leadRow) {
    return new Response(
      JSON.stringify({ error: "Lead upsert failed", detail: upsertLeadErr?.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  const leadId = leadRow.id;

  const calculatedRevenue = calculateRevenue(primaryVertical, extracted);

  const { data: callRow, error: callErr } = await supabase
    .from("calls")
    .insert({
      lead_id: leadId,
      company_id: companyId,
      transcript,
      recording_url: recordingUrl,
      extracted_data: extracted as Record<string, unknown>,
      calculated_revenue: calculatedRevenue,
    })
    .select("id")
    .single();

  if (callErr || !callRow) {
    return new Response(
      JSON.stringify({ error: "Call insert failed", detail: callErr?.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const underContract =
    String(status).toLowerCase().replace(/\s+/g, " ") === "under contract";
  if (underContract && primaryVertical === VERTICALS.RE4LTY) {
    for (const vert of RE4LTY_CROSS_SELL_VERTICALS) {
      const targetId = verticalToId.get(vert);
      if (targetId) {
        await supabase.from("cross_sells").upsert(
          {
            original_lead_id: leadId,
            target_company_id: targetId,
            status: "Pending",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "original_lead_id,target_company_id", ignoreDuplicates: false }
        );
      }
    }
  } else if (underContract && primaryVertical === VERTICALS.RENO) {
    const targetId = verticalToId.get(VERTICALS.WOLF_INSURANCE);
    if (targetId) {
      await supabase.from("cross_sells").upsert(
        {
          original_lead_id: leadId,
          target_company_id: targetId,
          status: "Pending",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "original_lead_id,target_company_id", ignoreDuplicates: false }
      );
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      lead_id: leadId,
      call_id: callRow.id,
      company_id: companyId,
      primary_vertical: primaryVertical,
      calculated_revenue: calculatedRevenue,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
});
