"use client";

/**
 * Ziarem: Gross Pipeline Value by vertical.
 * Pipeline value rules: Dos Mortgage = estimated_loan_amount * 0.0275; Laenan = 1000; Closed By Whom? = 1500; Wolf Insurance = 600.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PipelineMetricsProps {
  companyId?: string | null;
}

export function PipelineMetrics({ companyId }: PipelineMetricsProps) {
  const [value, setValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchPipeline() {
      let query = supabase
        .from("calls")
        .select("calculated_revenue")
        .not("calculated_revenue", "is", null);
      if (companyId) {
        query = query.eq("company_id", companyId);
      }
      const { data, error: e } = await query;
      if (cancelled) return;
      if (e) {
        setError(e.message);
        setValue(null);
      } else {
        const total = (data ?? []).reduce(
          (sum, row) => sum + Number(row.calculated_revenue ?? 0),
          0
        );
        setValue(total);
      }
      setLoading(false);
    }

    fetchPipeline();
    return () => {
      cancelled = true;
    };
  }, [companyId, supabase]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Gross Pipeline Value
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && (
          <p className="text-3xl font-bold tabular-nums">
            {loading
              ? "—"
              : value != null
                ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                : "—"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
