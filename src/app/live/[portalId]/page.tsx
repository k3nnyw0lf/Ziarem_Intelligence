"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import { DollarSign, Upload, Hammer, Shield } from "lucide-react";
import { AnimatedNumber } from "@/components/live/AnimatedNumber";
import { VERTICALS } from "@/shared/types/database";

const DOS_MORTGAGE = VERTICALS.DOS_MORTGAGE;
const LAENAN = VERTICALS.LAENAN;
const RENO = VERTICALS.RENO;
const WOLF_INSURANCE = VERTICALS.WOLF_INSURANCE;

const ORIGINATION_PERCENT = 2.75;
const LAENAN_PROCESSING_FEE = 1000;

interface LivePortalRow {
  id: string;
  lead_id: string;
  active_verticals: string[];
  dynamic_math: {
    estimated_home_value?: number;
    renovation_budget?: number;
    loan_amount?: number;
    origination_fee?: number;
    total_loan_with_origination?: number;
    laenan_processing_fee?: number;
    [key: string]: unknown;
  };
  is_viewing: boolean;
}

export default function LivePortalPage() {
  const params = useParams();
  const portalId = params?.portalId as string | undefined;
  const [portal, setPortal] = useState<LivePortalRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const focusReported = useRef(false);

  const supabase = createClient();

  const reportViewing = useCallback(async () => {
    if (!portalId || focusReported.current) return;
    focusReported.current = true;
    try {
      await supabase
        .from("live_portals")
        .update({ is_viewing: true, updated_at: new Date().toISOString() })
        .eq("id", portalId);
      await fetch("/api/webhooks/prospect-viewing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portal_id: portalId }),
      });
    } catch {
      // best effort
    }
  }, [portalId, supabase]);

  useEffect(() => {
    if (!portalId) {
      setLoading(false);
      setError("Missing portal ID");
      return;
    }

    const fetchOnce = async () => {
      const { data, err } = await supabase
        .from("live_portals")
        .select("id, lead_id, active_verticals, dynamic_math, is_viewing")
        .eq("id", portalId)
        .single();
      if (err) {
        setError(err.message);
        setPortal(null);
      } else {
        setPortal(data as LivePortalRow);
      }
      setLoading(false);
    };

    fetchOnce();

    const channel = supabase
      .channel(`live-portal-${portalId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_portals",
          filter: `id=eq.${portalId}`,
        },
        (payload) => {
          const next = payload.new as LivePortalRow;
          if (next) setPortal(next);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [portalId, supabase]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading your numbers…
      </div>
    );
  }

  if (error || !portal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        {error ?? "Portal not found"}
      </div>
    );
  }

  const math = portal.dynamic_math ?? {};
  const actives = portal.active_verticals ?? [];
  const hasDos = actives.includes(DOS_MORTGAGE);
  const hasLaenan = actives.includes(LAENAN);
  const hasReno = actives.includes(RENO);
  const hasWolf = actives.includes(WOLF_INSURANCE);

  const homeValue = Number(math.estimated_home_value) || 0;
  const renoBudget = Number(math.renovation_budget) || 0;
  const baseLoan = Number(math.loan_amount) || homeValue + renoBudget;
  const originationFee = Math.round((baseLoan * ORIGINATION_PERCENT) / 100);
  const totalLoanWithOrigination = baseLoan + originationFee;

  const updateRenoBudget = async (value: number) => {
    const nextMath = {
      ...math,
      renovation_budget: value,
      loan_amount: homeValue + value,
      origination_fee: Math.round(((homeValue + value) * ORIGINATION_PERCENT) / 100),
      total_loan_with_origination: homeValue + value + Math.round(((homeValue + value) * ORIGINATION_PERCENT) / 100),
    };
    setPortal((p) => (p ? { ...p, dynamic_math: nextMath } : p));
    await supabase
      .from("live_portals")
      .update({ dynamic_math: nextMath, updated_at: new Date().toISOString() })
      .eq("id", portalId);
  };

  return (
    <div
      className="min-h-screen bg-zinc-950 text-white"
      onFocus={reportViewing}
      onTouchStart={reportViewing}
    >
      <div className="mx-auto max-w-lg space-y-6 p-6 pb-20">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-b border-zinc-800 pb-4"
        >
          <h1 className="text-lg font-semibold">Ziarem — Your numbers</h1>
          <p className="text-sm text-zinc-500">Updates live as we talk</p>
        </motion.header>

        {hasDos && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="mb-3 flex items-center gap-2 text-zinc-400">
              <DollarSign className="h-4 w-4" />
              <span className="text-sm font-medium">{DOS_MORTGAGE}</span>
            </div>
            <p className="mb-2 text-xs text-zinc-500">
              Loan amount includes {ORIGINATION_PERCENT}% origination fee.
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Loan (before fee)</span>
                <AnimatedNumber value={baseLoan} format="currency" className="font-mono" />
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Origination ({ORIGINATION_PERCENT}%)</span>
                <AnimatedNumber value={originationFee} format="currency" className="font-mono text-amber-400" />
              </div>
              <div className="flex justify-between border-t border-zinc-700 pt-2 font-medium">
                <span>Total loan</span>
                <AnimatedNumber value={totalLoanWithOrigination} format="currency" className="font-mono text-green-400" />
              </div>
            </div>
          </motion.section>
        )}

        {hasReno && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="mb-3 flex items-center gap-2 text-zinc-400">
              <Hammer className="h-4 w-4" />
              <span className="text-sm font-medium">{RENO}</span>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              Drag the slider to see how your renovation budget changes the loan amount.
            </p>
            <div className="space-y-3">
              <input
                type="range"
                min={0}
                max={Math.max(200000, renoBudget + 50000)}
                step={5000}
                value={renoBudget}
                onChange={(e) => updateRenoBudget(Number(e.target.value))}
                className="h-2 w-full accent-green-500"
              />
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Renovation budget</span>
                <AnimatedNumber value={renoBudget} format="currency" className="font-mono" />
              </div>
              {hasDos && (
                <div className="flex justify-between border-t border-zinc-700 pt-2 text-sm">
                  <span className="text-zinc-400">Resulting loan (home + reno)</span>
                  <AnimatedNumber value={baseLoan} format="currency" className="font-mono text-green-400" />
                </div>
              )}
            </div>
          </motion.section>
        )}

        {hasLaenan && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="mb-3 flex items-center gap-2 text-zinc-400">
              <Upload className="h-4 w-4" />
              <span className="text-sm font-medium">{LAENAN}</span>
            </div>
            <div className="mb-3 rounded-lg bg-zinc-800/50 p-3">
              <span className="text-xs text-zinc-500">Processing fee (itemized)</span>
              <div className="mt-1 font-mono text-lg text-amber-400">
                <AnimatedNumber value={LAENAN_PROCESSING_FEE} format="currency" />
              </div>
            </div>
            <div className="rounded-lg border-2 border-dashed border-zinc-600 p-6 text-center text-sm text-zinc-500">
              Secure document upload — we&apos;ll send you a link when we&apos;re ready.
            </div>
          </motion.section>
        )}

        {hasWolf && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="mb-3 flex items-center gap-2 text-zinc-400">
              <Shield className="h-4 w-4" />
              <span className="text-sm font-medium">{WOLF_INSURANCE}</span>
            </div>
            <p className="text-sm text-zinc-500">Your insurance quote is being prepared. We&apos;ll update this section shortly.</p>
          </motion.section>
        )}

        {actives.length === 0 && (
          <p className="text-center text-sm text-zinc-500">No sections active yet. We&apos;re pulling your numbers now.</p>
        )}
      </div>
    </div>
  );
}
