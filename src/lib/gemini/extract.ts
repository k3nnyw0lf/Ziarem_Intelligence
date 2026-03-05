/**
 * Ziarem: LLM extraction via Gemini API.
 * Handles bilingual (EN/ES) and code-switching (Spanglish) transcripts;
 * use this as the single router for accurate intent, vertical, and financial extraction.
 */

export interface ExtractedCallPayload {
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

const VERTICALS_LIST =
  '"Re4lty Inc.", "RENO LLC", "Dos Mortgage LLC", "Laenan", "Closed By Whom?", "Wolf Insurance"';

const LEAD_STATUS_LIST = '"Cold", "Qualified", "Under Contract", "Closed"';

const SYSTEM_PROMPT = `You are the data extraction router for ziarem.com CRM. Transcripts may be English, Spanish, or code-switched (Spanglish). Extract structured data and return ONLY a single JSON object. No markdown.
Required keys when determinable:
- lead_intent (string): brief summary of what the lead wants
- primary_vertical (string): exactly one of ${VERTICALS_LIST}
- preferred_language (string): "EN" or "ES" only (infer from transcript language/code-switching)
- estimated_home_value (number) or estimated_loan_amount (number): numeric value when mentioned
- first_name, last_name (string): when stated
- location (string): default "Naples, Florida" if not stated
- status (string): exactly one of ${LEAD_STATUS_LIST} based on conversation outcome
- phone_number (string): if mentioned in transcript
- high_intent_to_close (boolean): true if the prospect clearly agreed to move forward, sign, or close
Return only valid JSON. Use null for missing optional fields.`;

export async function extractFromTranscript(
  transcript: string,
  apiKey: string
): Promise<ExtractedCallPayload> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${SYSTEM_PROMPT}\n\nTranscript:\n\n${transcript}` }],
          },
        ],
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
  return JSON.parse(text) as ExtractedCallPayload;
}
