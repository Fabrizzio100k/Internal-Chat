"use client";

import { createContext, useContext, useState, useCallback } from "react";

type SidebarContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Controla la visibilidad del sidebar de conversaciones en mobile, donde
 * se muestra como un drawer/overlay en vez de una columna fija. En desktop
 * el sidebar siempre está visible (ver clases responsive en ChatSidebar) y
 * este estado simplemente no se usa.
 */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <SidebarContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar debe usarse dentro de un SidebarProvider");
  }
  return ctx;
}
