/**
 * Ziarem cross-sell: when Re4lty Inc. lead moves to "Under Contract",
 * generate child records in the leads table for Dos Mortgage, Laenan, Closed By Whom?
 * linked to parent_lead_id, and create cross_sells rows for workflow status.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { VERTICALS } from "./revenue";

/** Re4lty Under Contract → child leads for these three (strict requirement). */
const RE4LTY_CHILD_LEAD_VERTICALS = [
  VERTICALS.DOS_MORTGAGE,
  VERTICALS.LAENAN,
  VERTICALS.CLOSED_BY_WHOM,
];

/** Also create cross_sells for Wolf Insurance (workflow). */
const RE4LTY_CROSS_SELL_VERTICALS = [
  VERTICALS.DOS_MORTGAGE,
  VERTICALS.LAENAN,
  VERTICALS.CLOSED_BY_WHOM,
  VERTICALS.WOLF_INSURANCE,
];

const RENO_CROSS_SELL_VERTICALS = [VERTICALS.WOLF_INSURANCE];

export function isUnderContract(status: string | undefined): boolean {
  if (!status) return false;
  const n = status.toLowerCase().replace(/\s+/g, " ");
  return n === "under contract";
}

async function getVerticalToId(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, vertical")
    .eq("active_status", true);
  if (error) throw new Error(`Companies fetch failed: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.vertical, c.id]));
}

interface ParentLead {
  id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  preferred_language: string;
  location: string;
  estimated_value: number | null;
}

/**
 * When Re4lty Inc. lead is Under Contract: create child records in leads
 * for Dos Mortgage, Laenan, Closed By Whom? (linked to parent_lead_id),
 * and upsert cross_sells for all four + RENO → Wolf only.
 */
export async function executeCrossSells(
  parentLead: ParentLead,
  primaryVertical: string,
  status: string | undefined
): Promise<boolean> {
  if (!isUnderContract(status)) return false;

  const verticalToId = await getVerticalToId();

  if (primaryVertical === VERTICALS.RE4LTY) {
    for (const vertical of RE4LTY_CHILD_LEAD_VERTICALS) {
      const companyId = verticalToId.get(vertical);
      if (companyId) {
        await supabaseAdmin.from("leads").insert({
          phone_number: parentLead.phone_number,
          first_name: parentLead.first_name,
          last_name: parentLead.last_name,
          preferred_language: parentLead.preferred_language === "ES" ? "ES" : "EN",
          location: parentLead.location,
          estimated_value: parentLead.estimated_value,
          status: "Cold",
          parent_lead_id: parentLead.id,
          company_id: companyId,
          updated_at: new Date().toISOString(),
        });
      }
    }
    for (const vertical of RE4LTY_CROSS_SELL_VERTICALS) {
      const targetId = verticalToId.get(vertical);
      if (targetId) {
        await supabaseAdmin.from("cross_sells").upsert(
          {
            original_lead_id: parentLead.id,
            target_company_id: targetId,
            status: "Pending",
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "original_lead_id,target_company_id",
            ignoreDuplicates: false,
          }
        );
      }
    }
    return true;
  }

  if (primaryVertical === VERTICALS.RENO) {
    const targetId = verticalToId.get(VERTICALS.WOLF_INSURANCE);
    if (targetId) {
      await supabaseAdmin.from("cross_sells").upsert(
        {
          original_lead_id: parentLead.id,
          target_company_id: targetId,
          status: "Pending",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "original_lead_id,target_company_id",
          ignoreDuplicates: false,
        }
      );
      return true;
    }
  }

  return false;
}
