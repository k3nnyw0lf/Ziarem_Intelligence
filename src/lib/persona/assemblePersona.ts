/**
 * Ziarem Pre-Call Assembly Engine: select sales framework + cultural matrix
 * from lead location, vertical, and language; return assembled system prompt.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { MASTER_SALES_PROMPT } from "@/lib/vapi/systemPrompt";

const VERTICALS = {
  RE4LTY: "Re4lty Inc.",
  RENO: "RENO LLC",
  DOS_MORTGAGE: "Dos Mortgage LLC",
  LAENAN: "Laenan",
  CLOSED_BY_WHOM: "Closed By Whom?",
  WOLF_INSURANCE: "Wolf Insurance",
} as const;

/** Vertical → sales framework name (directive). */
const VERTICAL_TO_FRAMEWORK: Record<string, string> = {
  [VERTICALS.RE4LTY]: "Sandler System",
  [VERTICALS.DOS_MORTGAGE]: "Sandler System",
  [VERTICALS.RENO]: "SPIN Selling",
  [VERTICALS.LAENAN]: "Straight Line Persuasion",
  [VERTICALS.CLOSED_BY_WHOM]: "Challenger Sale",
  [VERTICALS.WOLF_INSURANCE]: "Challenger Sale",
};

/** Resolve (location, language) → (region, language) for cultural_matrices. */
function getCulturalRegionAndLang(
  location: string | null,
  language: string
): { region: string; language: string } {
  const loc = (location ?? "").toLowerCase();
  const lang = language.toUpperCase();
  if (lang === "ES" && (loc.includes("miami") || loc.includes("miami-dade"))) {
    return { region: "Miami / Caribbean", language: "ES" };
  }
  if (lang === "EN" && (loc.includes("naples") || loc.includes("collier"))) {
    return { region: "Florida Gulf Coast / Naples", language: "EN" };
  }
  if (lang === "ES") return { region: "Standard Latin America", language: "ES" };
  return { region: "Florida Gulf Coast / Naples", language: "EN" };
}

export interface AssemblePersonaInput {
  lead_id: string;
  vertical: string;
}

export interface AssemblePersonaResult {
  systemPrompt: string;
  frameworkName: string | null;
  culturalRegion: string | null;
  culturalLanguage: string | null;
}

/**
 * Analyze lead, select framework and cultural matrix, concatenate
 * Base Identity + Sales Framework + Cultural Matrix into one systemPrompt.
 */
export async function assemblePersona(
  input: AssemblePersonaInput
): Promise<AssemblePersonaResult> {
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from("leads")
    .select("id, location, preferred_language")
    .eq("id", input.lead_id)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead not found: ${input.lead_id}`);
  }

  const language = (lead.preferred_language === "ES" ? "ES" : "EN") as string;
  const location = lead.location ?? "";

  const frameworkName =
    VERTICAL_TO_FRAMEWORK[input.vertical] ?? "Sandler System";
  const { data: framework } = await supabaseAdmin
    .from("sales_frameworks")
    .select("system_prompt_text")
    .eq("name", frameworkName)
    .single();

  const { region: cultureRegion, language: cultureLang } = getCulturalRegionAndLang(
    location,
    language
  );
  const { data: culture } = await supabaseAdmin
    .from("cultural_matrices")
    .select("system_prompt_text, region, language")
    .eq("region", cultureRegion)
    .eq("language", cultureLang)
    .single();

  const frameworkBlock = framework?.system_prompt_text ?? "";
  const cultureBlock = culture?.system_prompt_text ?? "";

  const systemPrompt = [
    MASTER_SALES_PROMPT.trim(),
    "",
    "--- SALES METHODOLOGY ---",
    frameworkBlock,
    "",
    "--- CULTURAL / TONE ---",
    cultureBlock,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    systemPrompt,
    frameworkName: framework?.system_prompt_text ? frameworkName : null,
    culturalRegion: culture?.region ?? null,
    culturalLanguage: culture?.language ?? null,
  };
}
