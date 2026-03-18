"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Company } from "@/shared/types/database";

export function useCompanies(): {
  companies: Company[];
  loading: boolean;
  error: string | null;
  getCompanyIdByVertical: (vertical: string) => string | null;
} {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("companies")
      .select("*")
      .eq("active_status", true)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) setError(e.message);
        else setCompanies((data as Company[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const getCompanyIdByVertical = (vertical: string): string | null => {
    const c = companies.find((x) => x.vertical === vertical);
    return c?.id ?? null;
  };

  return { companies, loading, error, getCompanyIdByVertical };
}
