/**
 * Ziarem RAG: real-time objection handling.
 * POST body: { objection_text } or { text }
 * Returns best-matching rebuttal from sales_objections (pgvector).
 * If no embedding match, falls back to text similarity on objection_text.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings/gemini";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const objectionText =
      (body?.objection_text ?? body?.text ?? "").trim().slice(0, 2048);

    if (!objectionText) {
      return NextResponse.json(
        { error: "Missing objection_text or text" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    let rebuttal: string | null = null;
    let matchScore: number | null = null;

    if (apiKey) {
      try {
        const embedding = await embedText(objectionText, apiKey);
        const { data: rows, error } = await supabaseAdmin.rpc("match_sales_objections", {
          query_embedding: JSON.stringify(embedding),
          match_threshold: 0.5,
          match_count: 1,
        });
        if (!error && rows?.[0]) {
          rebuttal = rows[0].rebuttal_text ?? null;
          matchScore = rows[0].similarity ?? null;
        }
      } catch (e) {
        console.warn("[objection-rebuttal] vector search failed:", e);
      }
    }

    if (!rebuttal) {
      const { data: fallback } = await supabaseAdmin
        .from("sales_objections")
        .select("rebuttal_text, objection_text")
        .not("rebuttal_text", "is", null)
        .limit(20);
      const best = (fallback ?? []).find(
        (r) =>
          r.objection_text &&
          objectionText.toLowerCase().includes((r.objection_text as string).toLowerCase())
      );
      if (best) rebuttal = best.rebuttal_text as string;
    }

    return NextResponse.json({
      rebuttal: rebuttal ?? null,
      matchScore: matchScore ?? null,
    });
  } catch (e) {
    console.error("[objection-rebuttal]", e);
    return NextResponse.json(
      { error: "Objection lookup failed", detail: String(e) },
      { status: 500 }
    );
  }
}
