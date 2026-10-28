"use client";

import { FileText, Image as ImageIcon, Link2, Video, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchFilter } from "@/lib/e2ee/search-index";

export const SEARCH_FILTERS: { id: SearchFilter; label: string; icon: typeof FileText }[] = [
  { id: "all", label: "Todo", icon: LayoutGrid },
  { id: "links", label: "Enlaces", icon: Link2 },
  { id: "images", label: "Imágenes", icon: ImageIcon },
  { id: "videos", label: "Videos", icon: Video },
  { id: "files", label: "Archivos", icon: FileText },
];

/** Filtros por tipo, estilo "segmented pills" de iOS. Desliza en horizontal si no caben. */
export function SearchFilterChips({
  value,
  onChange,
  className,
}: {
  value: SearchFilter;
  onChange: (filter: SearchFilter) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Filtrar por tipo"
      className={cn("flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]", className)}
    >
      {SEARCH_FILTERS.map(({ id, label, icon: Icon }) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95",
              active
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
