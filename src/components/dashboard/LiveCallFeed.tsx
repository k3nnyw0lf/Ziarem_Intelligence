"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Row shape from Supabase calls + optional company name. */
interface CallRow {
  id: string;
  created_at: string;
  transcript: string | null;
  extracted_data: Record<string, unknown> | null;
  calculated_revenue: number | null;
  company_vertical?: string;
}

export interface LiveCallFeedProps {
  /** Optional company id to filter by. */
  companyId?: string | null;
  /** Max rows to show. */
  limit?: number;
}

export function LiveCallFeed({ companyId, limit = 50 }: LiveCallFeedProps) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    async function fetchAndSubscribe() {
      let query = supabase
        .from("calls")
        .select(
          "id, created_at, transcript, extracted_data, calculated_revenue, company_id"
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (companyId) {
        query = query.eq("company_id", companyId);
      }

      const { data: initial, error: e } = await query;
      if (e) {
        setError(e.message);
        setCalls([]);
      } else {
        const rows = (initial ?? []).map((c) => ({
          id: c.id,
          created_at: c.created_at,
          transcript: c.transcript,
          extracted_data: (c.extracted_data as Record<string, unknown>) ?? null,
          calculated_revenue: c.calculated_revenue,
          company_vertical: undefined,
        }));
        setCalls(rows);
      }
      setLoading(false);

      const channel = supabase
        .channel("calls-feed")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "calls",
            ...(companyId ? { filter: `company_id=eq.${companyId}` } : {}),
          },
          async (payload) => {
            const newRow = payload.new as {
              id: string;
              created_at: string;
              transcript: string | null;
              extracted_data: unknown;
              calculated_revenue: number | null;
            };
            setCalls((prev) => [
              {
                id: newRow.id,
                created_at: newRow.created_at,
                transcript: newRow.transcript,
                extracted_data: (newRow.extracted_data as Record<string, unknown>) ?? null,
                calculated_revenue: newRow.calculated_revenue,
                company_vertical: undefined,
              },
              ...prev.slice(0, limit - 1),
            ]);
          }
        )
        .subscribe();
      subscription = { unsubscribe: () => supabase.removeChannel(channel) };
    }

    fetchAndSubscribe();
    return () => {
      subscription?.unsubscribe();
    };
  }, [companyId, limit, supabase]);

  const langBadge = (lang: string | undefined) => {
    if (!lang) return null;
    const l = String(lang).toUpperCase();
    return <Badge variant="outline">{l === "ES" ? "ES" : "EN"}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Live Call Feed</CardTitle>
        <p className="text-xs text-muted-foreground">
          Incoming and completed AI calls — language, vertical, intent
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {!error && (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Time</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Lead intent</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && calls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No calls yet
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  calls.map((row) => {
                    const ext = row.extracted_data ?? {};
                    const vertical = (ext.primary_vertical as string) ?? "—";
                    const intent = (ext.lead_intent as string) ?? (row.transcript?.slice(0, 60) ?? "—");
                    const lang = ext.preferred_language as string | undefined;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>{langBadge(lang)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{vertical}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate" title={intent}>
                          {intent}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.calculated_revenue != null
                            ? `$${Number(row.calculated_revenue).toLocaleString()}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
