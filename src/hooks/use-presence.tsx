"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const PRESENCE_CHANNEL_NAME = "presence:online-users";

const PresenceContext = createContext<Set<string>>(new Set());

/**
 * Proveedor único de presencia para toda la sección /chat. Abre un solo
 * canal de Supabase Realtime Presence compartido por todos los componentes
 * hijos (ChatSidebar, ChatWindow, etc.) vía Context, evitando el error
 * "cannot add presence callbacks after subscribe()" que ocurre cuando
 * múltiples componentes intentan suscribirse por separado al mismo canal.
 */
export function PresenceProvider({
  currentUserId,
  children,
}: {
  currentUserId: string;
  children: React.ReactNode;
}) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(PRESENCE_CHANNEL_NAME, {
      config: { presence: { key: currentUserId } },
    });
    channelRef.current = channel;

    const syncOnlineUsers = () => {
      const state = channel.presenceState();
      setOnlineUserIds(new Set(Object.keys(state)));
    };

    channel
      .on("presence", { event: "sync" }, syncOnlineUsers)
      .on("presence", { event: "join" }, syncOnlineUsers)
      .on("presence", { event: "leave" }, syncOnlineUsers)
      .subscribe(async (status, err) => {
        if (status === "SUBSCRIBED") {
          const trackResult = await channel.track({
            userId: currentUserId,
            onlineAt: new Date().toISOString(),
          });
          if (trackResult !== "ok") {
            console.error("[presence] track() no devolvió 'ok':", trackResult);
          }
          return;
        }

        // CHANNEL_ERROR, TIMED_OUT o CLOSED: antes esto quedaba en silencio
        // total. Lo logueamos para poder diagnosticar fallos de conexión
        // en producción (proxies, latencia, RLS, etc.) desde la consola.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[presence] Falló la conexión al canal (${status}):`, err);
        }
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  return <PresenceContext.Provider value={onlineUserIds}>{children}</PresenceContext.Provider>;
}

/** Devuelve el Set de userId actualmente conectados a la app. */
export function usePresence() {
  const onlineUserIds = useContext(PresenceContext);
  return { onlineUserIds };
}
