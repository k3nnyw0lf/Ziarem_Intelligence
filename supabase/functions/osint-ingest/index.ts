/**
 * Phase 8: OSINT ingest — cross-reference public records against leads and set trigger_event.
 * POST body: { source: string, records: Array<{ event_type, address?, zip?, ... }> }
 * Uses SUPABASE_SERVICE_ROLE_KEY; run from n8n Cron.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type EventType = "building_permit" | "notice_of_default" | "new_llc";

interface OsintRecord {
  event_type: EventType;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  property_address?: string;
  issue_date?: string;
  filing_date?: string;
  case_number?: string;
  entity_name?: string;
  source_url?: string;
  raw?: Record<string, unknown>;
}

function normalizeZip(record: OsintRecord): string | null {
  const z = record.zip?.replace(/\D/g, "").slice(0, 5);
  if (z && z.length >= 5) return z;
  const addr = (record.address ?? record.property_address ?? "").match(/\b(\d{5})(-\d{4})?\b/);
  return addr ? addr[1]! : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as { source?: string; records?: OsintRecord[] };
    const source = body.source ?? "unknown";
    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, matched: 0, message: "No records" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let matched = 0;
    const BATCH = 100;

    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH);
      for (const rec of chunk) {
        const zip = normalizeZip(rec);
        const eventType = (rec.event_type ?? "building_permit") as EventType;
        const metadata = {
          source,
          source_url: rec.source_url,
          date: rec.issue_date ?? rec.filing_date,
          address: rec.address ?? rec.property_address,
          city: rec.city,
          state: rec.state ?? "FL",
          zip: rec.zip ?? zip,
          case_number: rec.case_number,
          entity_name: rec.entity_name,
          raw: rec.raw,
        };

        if (zip) {
          const { data: leads } = await supabase
            .from("leads")
            .select("id")
            .ilike("location", `%${zip}%`)
            .limit(200);

          if (leads?.length) {
            const ids = leads.map((l) => l.id);
            const { error: updateErr } = await supabase
              .from("leads")
              .update({
                trigger_event: eventType,
                trigger_event_metadata: metadata,
                updated_at: new Date().toISOString(),
              })
              .in("id", ids);
            if (!updateErr) matched += ids.length;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, matched, source }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
