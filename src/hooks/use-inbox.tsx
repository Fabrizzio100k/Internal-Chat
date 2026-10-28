"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { INBOX_EVENT_NAME, type InboxEvent } from "@/lib/types/realtime";
import { createRealtimeFallback } from "@/lib/realtime-fallback";

type Handler = (event: InboxEvent) => void;

type InboxContextValue = {
  subscribe: (handler: Handler) => () => void;
};

const InboxContext = createContext<InboxContextValue | null>(null);

/**
 * UNA sola suscripción de tiempo real por pestaña: el "inbox" privado del
 * usuario. El servidor publica ahí únicamente los eventos de las conversaciones
 * en las que participa (ver lib/realtime-server.ts). Sidebar y ventana de chat
 * se registran con useInboxHandler en vez de abrir canales propios.
 */
export function InboxProvider({
  topic,
  children,
}: {
  /** Nombre del canal (HMAC secreto calculado en el servidor). */
  topic: string;
  children: React.ReactNode;
}) {
  const handlersRef = useRef(new Set<Handler>());

  const dispatch = useCallback((event: InboxEvent) => {
    handlersRef.current.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error("[inbox] handler error:", error);
      }
    });
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let hasConnectedBefore = false;
    let closing = false;

    // Respaldo: si el WebSocket no conecta en 30 s (VPN/proxy), pide lo último cada 5 s con el
    // mismo evento "resync" que ya usan la lista, el chat abierto y el guardián de sesión.
    const fallback = createRealtimeFallback({
      onPoll: () => dispatch({ type: "resync" }),
      isVisible: () => document.visibilityState === "visible",
    });
    const onVisible = () => fallback.pollNow();
    document.addEventListener("visibilitychange", onVisible);
    // Arranca "desconectado": si nunca llega a conectar, el respaldo entra a los 30 s.
    fallback.setConnected(false);

    const channel = supabase
      .channel(topic, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: INBOX_EVENT_NAME }, ({ payload }) => {
        dispatch(payload as InboxEvent);
      })
      .subscribe((status) => {
        // El CLOSED que provoca nuestro propio removeChannel() no es un corte de red.
        if (closing) return;
        if (status === "SUBSCRIBED") {
          const wasPolling = fallback.isPolling();
          fallback.setConnected(true);
          // Tras una reconexión (o tras haber sondeado) pudimos perder eventos: re-sincronizar.
          if (hasConnectedBefore || wasPolling) dispatch({ type: "resync" });
          hasConnectedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // La librería reintenta sola; mientras tanto corre la cuenta atrás del respaldo.
          fallback.setConnected(false);
        }
      });

    return () => {
      closing = true;
      document.removeEventListener("visibilitychange", onVisible);
      fallback.dispose();
      supabase.removeChannel(channel);
    };
  }, [topic, dispatch]);

  const value = useMemo<InboxContextValue>(
    () => ({
      subscribe: (handler) => {
        handlersRef.current.add(handler);
        return () => {
          handlersRef.current.delete(handler);
        };
      },
    }),
    [],
  );

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

/** Registra un handler de eventos del inbox mientras el componente esté montado. */
export function useInboxHandler(handler: Handler) {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error("useInboxHandler debe usarse dentro de un InboxProvider");

  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const { subscribe } = ctx;
  useEffect(() => subscribe((event) => handlerRef.current(event)), [subscribe]);
}
