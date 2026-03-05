/**
 * Revenue calculation by vertical (Ziarem business logic).
 * Used by webhook and Edge Function for calculated_revenue on calls.
 */

import type { ExtractedCallPayload } from "@/lib/gemini/extract";

export const VERTICALS = {
  RE4LTY: "Re4lty Inc.",
  RENO: "RENO LLC",
  DOS_MORTGAGE: "Dos Mortgage LLC",
  LAENAN: "Laenan",
  CLOSED_BY_WHOM: "Closed By Whom?",
  WOLF_INSURANCE: "Wolf Insurance",
} as const;

export function calculateRevenue(
  vertical: string,
  extracted: ExtractedCallPayload
): number | null {
  const loan =
    extracted.estimated_loan_amount ?? extracted.estimated_home_value;
  switch (vertical) {
    case VERTICALS.DOS_MORTGAGE:
      return loan != null ? Number((loan * 0.0275).toFixed(2)) : null;
    case VERTICALS.LAENAN:
      return 1000;
    case VERTICALS.CLOSED_BY_WHOM:
      return 1500;
    case VERTICALS.WOLF_INSURANCE:
      return 600;
    default:
      return null;
  }
}
