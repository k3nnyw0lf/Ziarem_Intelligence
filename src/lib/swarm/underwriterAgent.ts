/**
 * Phase 8: Underwriter agent — summarizes key terms and risk-relevant points from transcript
 * for the Frontline Agent to use without interrupting the vocal flow.
 */

export interface UnderwriterInput {
  transcriptChunk: string;
  previousContext?: string;
}

export interface UnderwriterResult {
  systemMessage: string | null;
  summary?: string;
}

export async function runUnderwriterAgent(
  input: UnderwriterInput,
  geminiApiKey: string
): Promise<UnderwriterResult> {
  const prompt = `You are the underwriter agent for ziarem.com. From this call transcript excerpt, extract: 1) Any key terms (timeline, condition, contingency). 2) One sentence summary. Return ONLY a JSON object: {"summary": "one sentence", "key_terms": ["term1", "term2"]}. If nothing relevant, return {"summary": "", "key_terms": []}.
Transcript:
${input.transcriptChunk}
${input.previousContext ? `\nPrevious:\n${input.previousContext}` : ""}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    }
  );

  if (!res.ok) return { systemMessage: null };
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";
  let parsed: { summary?: string; key_terms?: string[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { systemMessage: null };
  }

  const summary = parsed.summary?.trim() ?? "";
  const terms = parsed.key_terms ?? [];
  if (!summary && terms.length === 0) return { systemMessage: null };

  const systemMessage = `[Underwriter] ${summary}${terms.length ? ` Key terms: ${terms.join(", ")}.` : ""} Use only if relevant to the conversation.`;

  return { systemMessage, summary };
}
