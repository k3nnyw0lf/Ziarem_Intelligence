"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface DashboardContextValue {
  selectedVertical: string | null;
  setSelectedVertical: (v: string | null) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [selectedVertical, setSelectedVertical] = useState<string | null>(null);
  return (
    <DashboardContext.Provider value={{ selectedVertical, setSelectedVertical }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    return {
      selectedVertical: null,
      setSelectedVertical: () => {},
    };
  }
  return ctx;
}
