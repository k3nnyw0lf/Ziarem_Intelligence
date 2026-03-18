/**
 * Generate embedding for objection text using Gemini text-embedding-004 (768 dims).
 */

const GEMINI_EMBED_API =
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

export async function embedText(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch(`${GEMINI_EMBED_API}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { parts: [{ text: text.trim().slice(0, 2048) }] },
      taskType: "RETRIEVAL_QUERY",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embed error: ${res.status} ${err}`);
  }
  const data = await res.json();
  const embedding = data?.embedding?.values;
  if (!Array.isArray(embedding)) {
    throw new Error("Invalid embedding response");
  }
  return embedding;
}
