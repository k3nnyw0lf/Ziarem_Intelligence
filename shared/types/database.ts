/**
 * Database entity types (align with Supabase schema).
 * Bilingual: EN/ES supported across all user-facing fields.
 */

export type PreferredLanguage = 'EN' | 'ES';

export interface Company {
  id: string;
  name: string;
  vertical: string;
  is_partner: boolean;
  active_status: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  preferred_language: PreferredLanguage;
  location: string;
  estimated_value: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Call {
  id: string;
  lead_id: string;
  company_id: string;
  transcript: string | null;
  recording_url: string | null;
  extracted_data: ExtractedCallData;
  calculated_revenue: number | null;
  created_at: string;
  updated_at: string;
}

export type CrossSellStatus = 'Pending' | 'Contacted' | 'Closed';

export interface CrossSell {
  id: string;
  original_lead_id: string;
  target_company_id: string;
  status: CrossSellStatus;
  created_at: string;
  updated_at: string;
}

/** LLM-extracted payload from transcript (Gemini). */
export interface ExtractedCallData {
  lead_intent?: string;
  primary_vertical?: string;
  preferred_language?: PreferredLanguage;
  estimated_home_value?: number;
  estimated_loan_amount?: number;
  first_name?: string;
  last_name?: string;
  location?: string;
  status?: string;
  [key: string]: unknown;
}

/** Company vertical identifiers for routing. */
export const VERTICALS = {
  RE4LTY: 'Re4lty Inc.',
  RENO: 'RENO LLC',
  DOS_MORTGAGE: 'Dos Mortgage LLC',
  LAENAN: 'Laenan',
  CLOSED_BY_WHOM: 'Closed By Whom?',
  WOLF_INSURANCE: 'Wolf Insurance',
} as const;

/** Re4lty "Under Contract" triggers cross-sell to these. */
export const RE4LTY_CROSS_SELL_VERTICALS = [
  VERTICALS.DOS_MORTGAGE,
  VERTICALS.LAENAN,
  VERTICALS.CLOSED_BY_WHOM,
  VERTICALS.WOLF_INSURANCE,
] as const;

/** RENO anchor cross-sell. */
export const RENO_CROSS_SELL_VERTICALS = [VERTICALS.WOLF_INSURANCE] as const;
