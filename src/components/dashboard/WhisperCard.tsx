"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PhoneCall,
  AlertCircle,
  X,
  DollarSign,
  Globe,
  User,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/** Lead + company snippet from Supabase join */
interface LeadRow {
  first_name: string | null;
  last_name: string | null;
  phone_number: string;
  preferred_language: string | null;
}

interface CompanyRow {
  name: string | null;
  vertical: string | null;
}

interface CallRow {
  id: string;
  lead_id: string;
  company_id: string;
  extracted_data: Record<string, unknown> | null;
  leads?: LeadRow | LeadRow[] | null;
  companies?: CompanyRow | CompanyRow[] | null;
}

function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function leadName(lead: LeadRow | LeadRow[] | null | undefined): string {
  if (!lead) return "—";
  const L = Array.isArray(lead) ? lead[0] : lead;
  if (!L) return "—";
  const first = L.first_name?.trim() ?? "";
  const last = L.last_name?.trim() ?? "";
  return [first, last].filter(Boolean).join(" ") || "—";
}

function leadPhone(lead: LeadRow | LeadRow[] | null | undefined): string {
  if (!lead) return "—";
  const L = Array.isArray(lead) ? lead[0] : lead;
  return L?.phone_number ?? "—";
}

function verticalName(company: CompanyRow | CompanyRow[] | null | undefined): string {
  if (!company) return "—";
  const C = Array.isArray(company) ? company[0] : company;
  return C?.vertical ?? C?.name ?? "—";
}

/**
 * Global real-time intercept modal: listens to Supabase `calls` via WebSockets
 * and shows critical lead context when agent_transfer_status = 'Transferring_to_Ken'.
 */
export function WhisperCard() {
  const [transferData, setTransferData] = useState<CallRow | null>(null);

  const fetchTransferContext = useCallback(async (callId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("calls")
      .select(
        "id, lead_id, company_id, extracted_data, leads(first_name, last_name, phone_number, preferred_language), companies(name, vertical)"
      )
      .eq("id", callId)
      .single();

    if (error || !data) {
      console.warn("WhisperCard: failed to fetch call context", error);
      return;
    }
    setTransferData(data as unknown as CallRow);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("live-transfers")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "calls",
          filter: "agent_transfer_status=eq.Transferring_to_Ken",
        },
        (payload) => {
          const newRow = payload.new as { id: string; agent_transfer_status?: string };
          if (newRow?.agent_transfer_status === "Transferring_to_Ken" && newRow.id) {
            fetchTransferContext(newRow.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTransferContext]);

  const dismiss = () => setTransferData(null);

  if (!transferData) return null;

  const ext = (transferData.extracted_data ?? {}) as Record<string, unknown>;
  const intentSummary =
    (ext.intent_summary as string) ??
    (ext.lead_intent as string) ??
    "—";
  const estimatedValue =
    ext.estimated_value ??
    ext.estimated_loan_amount ??
    ext.estimated_home_value ??
    null;
  const languagePref = (ext.preferred_language as string) ?? transferData.leads?.preferred_language ?? "EN";
  const vertical = verticalName(transferData.companies) || (ext.primary_vertical as string) || "—";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", damping: 24, stiffness: 360 }}
        className="fixed bottom-4 right-4 z-50 w-[26rem] overflow-hidden rounded-xl border-2 border-green-500 bg-gray-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-800 bg-green-500/10 p-4">
          <div className="flex items-center gap-2 text-green-400">
            <PhoneCall className="h-5 w-5 animate-pulse" />
            <span className="text-sm font-bold tracking-wider">
              INBOUND HOT TRANSFER
            </span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="text-gray-400 hover:text-white"
            aria-label="Dismiss"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <User className="h-4 w-4" />
              <span>{leadName(transferData.leads)}</span>
              <span className="text-gray-500">·</span>
              <span className="tabular-nums">{leadPhone(transferData.leads)}</span>
            </div>
            <h3 className="mt-1 text-xl font-bold text-white">{vertical}</h3>
            <p className="mt-0.5 text-sm text-gray-400">
              Targeting: {intentSummary}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col rounded-lg bg-gray-800 p-3">
              <span className="text-xs font-semibold uppercase text-gray-500">
                Pipeline Value
              </span>
              <div className="mt-1 flex items-center text-lg font-bold text-green-400">
                <DollarSign className="mr-1 h-4 w-4" />
                {formatCurrency(estimatedValue)}
              </div>
            </div>
            <div className="flex flex-col rounded-lg bg-gray-800 p-3">
              <span className="text-xs font-semibold uppercase text-gray-500">
                Language
              </span>
              <div className="mt-1 flex items-center text-lg font-bold text-blue-400">
                <Globe className="mr-1 h-4 w-4" />
                {languagePref === "ES" ? "Spanish" : "English"}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-blue-800/50 bg-blue-900/20 p-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
            <p className="text-sm text-blue-200">
              AI is bridging the call to your cell now. Pick up and say:
              <br />
              <span className="mt-1 block font-semibold italic">
                &ldquo;Hi, I have your file right here regarding the {vertical} request…&rdquo;
              </span>
            </p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
