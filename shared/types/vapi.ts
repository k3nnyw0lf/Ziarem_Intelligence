/**
 * Vapi webhook payload types (inbound POST from Vapi).
 * Used by Supabase Edge Function for ingestion.
 */

export interface VapiWebhookPayload {
  message?: {
    type?: string;
    transcript?: string;
    transcriptFinal?: boolean;
  };
  call?: {
    id?: string;
    recordingUrl?: string;
    endedReason?: string;
  };
  /** Raw transcript (some integrations send at top level). */
  transcript?: string;
  /** Recording URL (alternate location). */
  recording_url?: string;
}
