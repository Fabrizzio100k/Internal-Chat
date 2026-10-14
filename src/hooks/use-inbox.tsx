"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { INBOX_EVENT_NAME, type InboxEvent } from "@/lib/types/realtime";

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

    const channel = supabase
      .channel(topic, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: INBOX_EVENT_NAME }, ({ payload }) => {
        dispatch(payload as InboxEvent);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Tras una reconexión pudimos perder eventos: pedir re-sincronizar.
        if (hasConnectedBefore) dispatch({ type: "resync" });
        hasConnectedBefore = true;
      });

    return () => {
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
