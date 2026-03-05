"use client";

import { useLocale } from "@/lib/i18n";
import { DashboardShell } from "@/components/DashboardShell";

const labels: Record<string, { en: string; es: string }> = {
  leads: { en: "Leads", es: "Leads" },
  calls: { en: "Calls", es: "Llamadas" },
  cross_sells: { en: "Cross-sells", es: "Ventas cruzadas" },
  total_leads: { en: "Total leads", es: "Total de leads" },
  today: { en: "Today", es: "Hoy" },
  pending: { en: "Pending", es: "Pendientes" },
};

function StatCard({
  titleKey,
  value,
  subtitleKey,
  locale,
}: {
  titleKey: string;
  value: string;
  subtitleKey: string;
  locale: "en" | "es";
}) {
  const lang = locale === "es" ? "es" : "en";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {labels[titleKey]?.[lang] ?? titleKey}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {labels[subtitleKey]?.[lang] ?? subtitleKey}
      </p>
    </div>
  );
}

export default function Home() {
  const { locale } = useLocale();
  return (
    <DashboardShell>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <StatCard titleKey="leads" value="—" subtitleKey="total_leads" locale={locale} />
        <StatCard titleKey="calls" value="—" subtitleKey="today" locale={locale} />
        <StatCard titleKey="cross_sells" value="—" subtitleKey="pending" locale={locale} />
      </div>
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Dashboard
        </h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Connect Supabase and configure the Vapi webhook to start ingesting
          calls. Webhook URL:{" "}
          <code className="rounded bg-gray-200 px-1 dark:bg-gray-700">
            /functions/v1/vapi-ingest
          </code>
        </p>
      </section>
    </DashboardShell>
  );
}
