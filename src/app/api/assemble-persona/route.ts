/**
 * Ziarem Pre-Call Assembly Engine.
 * Call this ~1 second before n8n triggers the Vapi outbound call.
 * POST body: { lead_id, vertical }
 * Returns: { systemPrompt, frameworkName, culturalRegion, culturalLanguage }
 * for injection into Vapi /call/outbound request.
 */

import { NextResponse } from "next/server";
import { assemblePersona } from "@/lib/persona/assemblePersona";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const leadId = body?.lead_id;
    const vertical = body?.vertical;

    if (!leadId || typeof leadId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid lead_id" },
        { status: 400 }
      );
    }
    if (!vertical || typeof vertical !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid vertical" },
        { status: 400 }
      );
    }

    const result = await assemblePersona({ lead_id: leadId, vertical });

    return NextResponse.json({
      systemPrompt: result.systemPrompt,
      frameworkName: result.frameworkName,
      culturalRegion: result.culturalRegion,
      culturalLanguage: result.culturalLanguage,
    });
  } catch (e) {
    console.error("[assemble-persona]", e);
    return NextResponse.json(
      { error: "Assembly failed", detail: String(e) },
      { status: 500 }
    );
  }
}
