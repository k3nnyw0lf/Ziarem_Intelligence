/**
 * Phase 8: Quant agent — autonomously calculates Dos Mortgage / Laenan fees from transcript
 * and returns a system_message string to inject into the Vapi Frontline Agent.
 */

const DOS_ORIGINATION_PERCENT = 2.75;
const LAENAN_FEE = 1000;

export interface QuantInput {
  transcriptChunk: string;
  previousContext?: string;
}

export interface QuantResult {
  systemMessage: string | null;
  loanAmount?: number;
  originationFee?: number;
  totalLoan?: number;
  laenanFee?: number;
}

export async function runQuantAgent(
  input: QuantInput,
  geminiApiKey: string
): Promise<QuantResult> {
  const prompt = `You are the quant agent for ziarem.com. From this call transcript excerpt, extract any mentioned dollar amounts (home value, loan amount, renovation budget). Return ONLY a JSON object with keys: loan_amount (number or null), home_value (number or null), renovation_budget (number or null). If no numbers are mentioned, return {"loan_amount": null, "home_value": null, "renovation_budget": null}. No other text.
Transcript:
${input.transcriptChunk}
${input.previousContext ? `\nPrevious context:\n${input.previousContext}` : ""}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    }
  );

  if (!res.ok) return { systemMessage: null };
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";
  let parsed: { loan_amount?: number | null; home_value?: number | null; renovation_budget?: number | null };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { systemMessage: null };
  }

  const loanAmount =
    parsed.loan_amount ??
    (parsed.home_value && parsed.renovation_budget
      ? parsed.home_value + parsed.renovation_budget
      : parsed.home_value);
  if (loanAmount == null || loanAmount <= 0) return { systemMessage: null };

  const originationFee = Math.round((loanAmount * DOS_ORIGINATION_PERCENT) / 100);
  const totalLoan = loanAmount + originationFee;
  const systemMessage = `[Quant] Dos Mortgage: loan $${loanAmount.toLocaleString()}, ${DOS_ORIGINATION_PERCENT}% origination $${originationFee.toLocaleString()}, total $${totalLoan.toLocaleString()}. Laenan processing: $${LAENAN_FEE.toLocaleString()}. Say these numbers naturally if the prospect asks.`;

  return {
    systemMessage,
    loanAmount,
    originationFee,
    totalLoan,
    laenanFee: LAENAN_FEE,
  };
}
