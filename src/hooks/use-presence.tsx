"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const PRESENCE_CHANNEL_NAME = "presence:online-users";
const MAX_RETRY_DELAY_MS = 30_000;

type PresenceContextValue = {
  onlineUserIds: Set<string>;
  /**
   * false si el canal de Realtime nunca logró conectar (p. ej. un firewall/
   * proxy de red bloqueando WebSockets). Cuando es false, el estado "online"
   * de todos los usuarios no es confiable, no significa que estén offline.
   */
  isRealtimeConnected: boolean;
};

const PresenceContext = createContext<PresenceContextValue>({
  onlineUserIds: new Set(),
  isRealtimeConnected: false,
});

/**
 * Proveedor único de presencia para toda la sección /chat. Abre un solo
 * canal de Supabase Realtime Presence compartido por todos los componentes
 * hijos (ChatSidebar, ChatWindow, etc.) vía Context, evitando el error
 * "cannot add presence callbacks after subscribe()" que ocurre cuando
 * múltiples componentes intentan suscribirse por separado al mismo canal.
 *
 * Si el WebSocket no puede conectar (firewall/proxy de red bloqueando
 * wss://, común en redes corporativas), reintenta con backoff exponencial
 * en vez de rendirse tras el primer fallo. Un CLOSED disparado por nuestro
 * propio removeChannel() (cleanup del efecto, remount en dev, cambio de
 * currentUserId) no cuenta como fallo: se distingue con
 * isClosingIntentionallyRef para no loguearlo ni disparar un reintento
 * innecesario.
 */
export function PresenceProvider({
  currentUserId,
  children,
}: {
  currentUserId: string;
  children: React.ReactNode;
}) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const isUnmountedRef = useRef(false);
  // true mientras estamos cerrando el canal a propósito (cleanup del efecto,
  // remount de React en dev, cambio de currentUserId). removeChannel()
  // dispara internamente el mismo evento CLOSED que un corte de red real, y
  // sin esta bandera no había forma de distinguir "me desconecté yo" de
  // "la red me desconectó" dentro del callback de subscribe().
  const isClosingIntentionallyRef = useRef(false);

  useEffect(() => {
    isUnmountedRef.current = false;
    const supabase = createSupabaseBrowserClient();

    function connect() {
      isClosingIntentionallyRef.current = false;
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
            retryCountRef.current = 0;
            setIsRealtimeConnected(true);
            const trackResult = await channel.track({
              userId: currentUserId,
              onlineAt: new Date().toISOString(),
            });
            if (trackResult !== "ok") {
              console.error("[presence] track() no devolvió 'ok':", trackResult);
            }
            return;
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // Un CLOSED disparado por nuestro propio removeChannel() en el
            // cleanup (desmontaje, remount de StrictMode/dev, o cambio de
            // currentUserId) no es un fallo: es la consecuencia esperada de
            // cerrar el canal a propósito. No lo logueamos ni reintentamos.
            if (isClosingIntentionallyRef.current) return;

            // Frecuente en redes corporativas/con firewall que bloquean
            // WebSockets salientes: no es un bug de la app, es la red del
            // cliente. Reintentamos con backoff en vez de quedarnos colgados.
            console.error(`[presence] Falló la conexión al canal (${status}):`, err);
            setIsRealtimeConnected(false);

            if (isUnmountedRef.current) return;

            const delay = Math.min(1000 * 2 ** retryCountRef.current, MAX_RETRY_DELAY_MS);
            retryCountRef.current += 1;
            supabase.removeChannel(channel);
            retryTimeoutRef.current = setTimeout(() => {
              if (!isUnmountedRef.current) connect();
            }, delay);
          }
        });
    }

    connect();

    return () => {
      isUnmountedRef.current = true;
      isClosingIntentionallyRef.current = true;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [currentUserId]);

  return (
    <PresenceContext.Provider value={{ onlineUserIds, isRealtimeConnected }}>
      {children}
    </PresenceContext.Provider>
  );
}

/** Devuelve el Set de userId conectados y si el canal de Realtime está activo. */
export function usePresence() {
  return useContext(PresenceContext);
}
