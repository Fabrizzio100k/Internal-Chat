"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { METHOD_TONE } from "@/lib/hombrepost/http";
import type { RequestTab } from "@/lib/hombrepost/types";
import { cn } from "@/lib/utils";

/**
 * Pestañas de peticiones abiertas. Scroll horizontal en móvil en vez de
 * apilarse, para que la barra no se coma la altura útil de la pantalla.
 */
export function RequestTabsBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: RequestTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex items-stretch border-b">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        <AnimatePresence initial={false}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;

            return (
              <motion.div
                key={tab.id}
                layout
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18 }}
                className="relative flex shrink-0 items-center"
              >
                <button
                  type="button"
                  onClick={() => onSelect(tab.id)}
                  className={cn(
                    "flex max-w-52 items-center gap-1.5 py-2 pr-1 pl-3 text-xs transition-colors",
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className={cn("font-mono font-semibold", METHOD_TONE[tab.draft.method])}>
                    {tab.draft.method}
                  </span>
                  <span className="truncate">{tab.draft.name || "Sin nombre"}</span>
                  {tab.dirty ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-amber-500"
                      aria-label="Con cambios sin guardar"
                    />
                  ) : null}
                </button>

                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="mr-1.5"
                  aria-label={`Cerrar ${tab.draft.name}`}
                  onClick={() => onClose(tab.id)}
                >
                  <X />
                </Button>

                {isActive ? (
                  <motion.span
                    layoutId="hombrepost-active-tab"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        className="m-1 shrink-0"
        aria-label="Nueva petición"
        onClick={onNew}
      >
        <Plus />
      </Button>
    </div>
  );
}
