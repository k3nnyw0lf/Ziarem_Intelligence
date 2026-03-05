"use client";

import { useMemo } from "react";
import { useCompanies } from "@/lib/hooks/useCompanies";
import { useDashboardContext } from "@/app/(dashboard)/DashboardContext";
import { PipelineMetrics } from "@/components/dashboard/PipelineMetrics";
import { LiveCallFeed } from "@/components/dashboard/LiveCallFeed";
import { WhisperCard } from "@/components/dashboard/WhisperCard";

export function DashboardContent() {
  const { selectedVertical } = useDashboardContext();
  const { getCompanyIdByVertical } = useCompanies();
  const selectedCompanyId = useMemo(
    () => (selectedVertical ? getCompanyIdByVertical(selectedVertical) : null),
    [selectedVertical, getCompanyIdByVertical]
  );

  return (
    <>
      <WhisperCard />
      <section className="mb-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Overview
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PipelineMetrics companyId={selectedCompanyId} />
          <div className="rounded-xl border border-border bg-card p-6 shadow">
            <p className="text-sm font-medium text-muted-foreground">
              Entity filter
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {selectedVertical ?? "All"}
            </p>
          </div>
        </div>
      </section>
      <section>
        <LiveCallFeed companyId={selectedCompanyId} limit={50} />
      </section>
    </>
  );
}
