"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type Locale = "en" | "es";

const copy: Record<string, Record<Locale, string>> = {
  nav_dashboard: { en: "Dashboard", es: "Panel" },
  nav_leads: { en: "Leads", es: "Leads" },
  nav_calls: { en: "Calls", es: "Llamadas" },
  nav_cross_sells: { en: "Cross-sells", es: "Ventas cruzadas" },
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "es" ? "es" : "en";
    }
  }, []);
  const t = useCallback(
    (key: string) => copy[key]?.[locale] ?? key,
    [locale]
  );
  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useLocale(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: "en",
      setLocale: () => {},
      t: (k: string) => k,
    };
  }
  return ctx;
}
