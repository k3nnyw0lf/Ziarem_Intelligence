"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface TransferCall {
  id: string;
  transcript: string | null;
  extracted_data: Record<string, unknown> | null;
  created_at: string;
}

/**
 * When a call's agent_transfer_status updates to Transferring_to_Ken,
 * pops up a modal with intent_summary, estimated_value, and live transcript
 * so Ken has full context upon answering.
 */
export function WhisperCard() {
  const [open, setOpen] = useState(false);
  const [call, setCall] = useState<TransferCall | null>(null);
  const supabase = createClient();

  const fetchCall = useCallback(
    async (callId: string) => {
      const { data } = await supabase
        .from("calls")
        .select("id, transcript, extracted_data, created_at")
        .eq("id", callId)
        .single();
      if (data) {
        setCall({
          id: data.id,
          transcript: data.transcript,
          extracted_data: (data.extracted_data as Record<string, unknown>) ?? null,
          created_at: data.created_at,
        });
        setOpen(true);
      }
    },
    [supabase]
  );

  useEffect(() => {
    const channel = supabase
      .channel("whisper-transfer")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls" },
        (payload) => {
          const newRow = payload.new as { id: string; agent_transfer_status?: string };
          if (newRow?.agent_transfer_status === "Transferring_to_Ken" && newRow.id) {
            fetchCall(newRow.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchCall]);

  const ext = call?.extracted_data ?? {};
  const intentSummary =
    (ext.lead_intent as string) ?? (ext.intent_summary as string) ?? "—";
  const estimatedValue =
    ext.estimated_loan_amount ??
    ext.estimated_home_value ??
    ext.estimated_value ??
    "—";
  const displayValue =
    typeof estimatedValue === "number"
      ? `$${estimatedValue.toLocaleString()}`
      : String(estimatedValue);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>Incoming transfer – Ken</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto min-h-0">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Intent summary
            </p>
            <p className="mt-1 text-sm">{intentSummary}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Estimated value
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{displayValue}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Live transcript
            </p>
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
              {call?.transcript || "—"}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
