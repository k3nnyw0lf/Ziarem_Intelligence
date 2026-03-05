"use client";

import { useLocale } from "@/lib/i18n";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            AI Call Center CRM
          </h1>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "es" : "en")}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              aria-label={locale === "en" ? "Español" : "English"}
            >
              {locale === "en" ? "ES" : "EN"}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
