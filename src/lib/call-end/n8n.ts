/**
 * Trigger n8n webhook for bilingual onboarding emails after cross-sell creation.
 * Webhook is hosted on Hostinger (self-hosted n8n). Failures are logged but do not fail the pipeline.
 */

export interface N8nOnboardingPayload {
  lead_id: string;
  lead_phone?: string;
  lead_first_name?: string;
  lead_last_name?: string;
  preferred_language: "EN" | "ES";
  vertical: string;
  cross_sell_triggered: boolean;
  /** ISO timestamp */
  triggered_at: string;
}

/**
 * Fire n8n webhook with payload. No throw; log errors for fallback handling.
 */
export async function triggerN8nOnboarding(payload: N8nOnboardingPayload): Promise<void> {
  const url = process.env.N8N_WEBHOOK_ONBOARDING_URL;
  if (!url) {
    console.warn("[n8n] N8N_WEBHOOK_ONBOARDING_URL not set; skipping onboarding webhook.");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn("[n8n] Onboarding webhook failed:", res.status, await res.text());
    }
  } catch (e) {
    console.warn("[n8n] Onboarding webhook error:", e);
  }
}
