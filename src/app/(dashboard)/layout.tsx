"use client";

/**
 * Ziarem Enterprise: dashboard shell for realty, mortgage, insurance.
 * Bilingual (EN/ES); Lucide icons. Content is provided by each route.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, FileText, Shield, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardProvider, useDashboardContext } from "@/app/(dashboard)/DashboardContext";
import { EntitySidebar } from "@/components/dashboard/EntitySidebar";

const NAV: { href: string; labelEn: string; labelEs: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { href: "/realty", labelEn: "Realty", labelEs: "Inmobiliaria", icon: Building2 },
  { href: "/mortgage", labelEn: "Mortgage", labelEs: "Hipotecario", icon: FileText },
  { href: "/insurance", labelEn: "Insurance", labelEs: "Seguros", icon: Shield },
];

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { selectedVertical, setSelectedVertical } = useDashboardContext();

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-6">
          <Link href="/realty" className="flex items-center gap-2 font-semibold">
            <LayoutDashboard className="h-5 w-5" />
            Ziarem.com
          </Link>
          <nav className="flex gap-1">
            {NAV.map(({ href, labelEn, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  pathname === href
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {labelEn}
              </Link>
            ))}
          </nav>
        </div>
        <span className="text-xs text-muted-foreground">EN | ES</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <EntitySidebar
          selectedVertical={selectedVertical}
          onSelectVertical={setSelectedVertical}
        />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardProvider>
  );
}
