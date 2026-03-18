"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VERTICALS } from "@/shared/types/database";

export interface EntitySidebarProps {
  /** Selected company vertical; null = all. */
  selectedVertical: string | null;
  onSelectVertical: (vertical: string | null) => void;
  className?: string;
}

const ENTITY_LABELS: Record<string, string> = {
  [VERTICALS.RE4LTY]: "Re4lty Inc.",
  [VERTICALS.RENO]: "RENO LLC",
  [VERTICALS.DOS_MORTGAGE]: "Dos Mortgage",
  [VERTICALS.LAENAN]: "Laenan",
  [VERTICALS.CLOSED_BY_WHOM]: "Closed By Whom?",
  [VERTICALS.WOLF_INSURANCE]: "Wolf Insurance",
};

const ENTITY_ORDER = [
  VERTICALS.RE4LTY,
  VERTICALS.RENO,
  VERTICALS.DOS_MORTGAGE,
  VERTICALS.LAENAN,
  VERTICALS.CLOSED_BY_WHOM,
  VERTICALS.WOLF_INSURANCE,
];

export function EntitySidebar({
  selectedVertical,
  onSelectVertical,
  className,
}: EntitySidebarProps) {
  return (
    <aside
      className={cn(
        "flex w-56 flex-col border-r border-border bg-card py-4",
        className
      )}
    >
      <h2 className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Entities
      </h2>
      <nav className="mt-4 flex flex-col gap-0.5 px-2">
        <Button
          variant={selectedVertical === null ? "secondary" : "ghost"}
          size="sm"
          className="justify-start font-normal"
          onClick={() => onSelectVertical(null)}
        >
          All
        </Button>
        {ENTITY_ORDER.map((vertical) => (
          <Button
            key={vertical}
            variant={selectedVertical === vertical ? "secondary" : "ghost"}
            size="sm"
            className="justify-start font-normal"
            onClick={() => onSelectVertical(vertical)}
          >
            {ENTITY_LABELS[vertical] ?? vertical}
          </Button>
        ))}
      </nav>
    </aside>
  );
}
