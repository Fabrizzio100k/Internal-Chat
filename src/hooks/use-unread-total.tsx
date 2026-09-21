"use client";

import { createContext, useContext, useState } from "react";

type UnreadTotalContextValue = {
  totalUnread: number;
  setTotalUnread: (total: number) => void;
};

const UnreadTotalContext = createContext<UnreadTotalContextValue | null>(null);

/**
 * Proveedor del total de mensajes no leídos (suma de unreadCount de todas
 * las conversaciones). ChatSidebar reporta el total cada vez que cambia su
 * estado; FaviconBadge y TabTitle lo consumen para actualizar el favicon
 * y el <title> de la pestaña del navegador.
 */
export function UnreadTotalProvider({ children }: { children: React.ReactNode }) {
  const [totalUnread, setTotalUnread] = useState(0);

  return (
    <UnreadTotalContext.Provider value={{ totalUnread, setTotalUnread }}>
      {children}
    </UnreadTotalContext.Provider>
  );
}

export function useUnreadTotal() {
  const ctx = useContext(UnreadTotalContext);
  if (!ctx) {
    throw new Error("useUnreadTotal debe usarse dentro de un UnreadTotalProvider");
  }
  return ctx;
}
