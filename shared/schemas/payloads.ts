/**
 * Zod schemas for API payloads (validation in Edge Functions and Next.js API routes).
 */

import { z } from 'zod';

export const preferredLanguageSchema = z.enum(['EN', 'ES']);

export const extractedCallDataSchema = z.object({
  lead_intent: z.string().optional(),
  primary_vertical: z.string().optional(),
  preferred_language: preferredLanguageSchema.optional(),
  estimated_home_value: z.number().optional(),
  estimated_loan_amount: z.number().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

export type ExtractedCallDataSchema = z.infer<typeof extractedCallDataSchema>;

/** Vapi POST body (minimal required fields for ingestion). */
export const vapiWebhookBodySchema = z.object({
  message: z.object({
    type: z.string().optional(),
    transcript: z.string().optional(),
    transcriptFinal: z.boolean().optional(),
  }).optional(),
  call: z.object({
    id: z.string().optional(),
    recordingUrl: z.string().url().optional(),
    endedReason: z.string().optional(),
  }).optional(),
  transcript: z.string().optional(),
  recordingUrl: z.string().url().optional(),
  recording_url: z.string().url().optional(),
}).passthrough();

export type VapiWebhookBody = z.infer<typeof vapiWebhookBodySchema>;
