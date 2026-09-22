"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const TYPING_EVENT = "typing";
// Tiempo tras el cual, si no llega un nuevo evento "typing", asumimos que
// la otra persona dejó de escribir (protege contra el caso en que el cliente
// remoto se cierre/pierda conexión sin enviar un evento explícito de "stop").
const TYPING_TIMEOUT_MS = 4000;
// Intervalo mínimo entre envíos de "estoy escribiendo" mientras el usuario
// sigue tecleando, para no saturar el canal de broadcast con un evento por tecla.
const TYPING_EMIT_THROTTLE_MS = 2000;

/**
 * Comparte el estado de "está escribiendo..." de una conversación 1:1 vía
 * Supabase Realtime Broadcast (efímero, no persiste en la base de datos).
 * Cada participante escucha el canal `typing:{conversationId}` y emite un
 * evento cuando teclea; el otro lado calcula "sigue escribiendo" con un
 * timeout local en vez de esperar un evento explícito de "paró".
 */
export function useTypingStatus(conversationId: string, currentUserId: string) {
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const clearTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastEmitRef = useRef(0);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: TYPING_EVENT }, (payload) => {
        const { userId } = payload.payload as { userId: string };
        if (userId === currentUserId) return;

        setTypingUserIds((prev) => {
          if (prev.has(userId)) return prev;
          const next = new Set(prev);
          next.add(userId);
          return next;
        });

        const existingTimeout = clearTimeoutsRef.current.get(userId);
        if (existingTimeout) clearTimeout(existingTimeout);

        const timeout = setTimeout(() => {
          setTypingUserIds((prev) => {
            if (!prev.has(userId)) return prev;
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
          clearTimeoutsRef.current.delete(userId);
        }, TYPING_TIMEOUT_MS);

        clearTimeoutsRef.current.set(userId, timeout);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      const timeouts = clearTimeoutsRef.current;
      timeouts.forEach((timeout) => clearTimeout(timeout));
      timeouts.clear();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, currentUserId]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastEmitRef.current < TYPING_EMIT_THROTTLE_MS) return;
    lastEmitRef.current = now;

    channelRef.current?.send({
      type: "broadcast",
      event: TYPING_EVENT,
      payload: { userId: currentUserId },
    });
  }, [currentUserId]);

  return { typingUserIds, notifyTyping };
}

/**
 * Variante para el sidebar: escucha el estado de "escribiendo" de VARIAS
 * conversaciones a la vez (una por cada conversación listada), a diferencia
 * de useTypingStatus que sigue una sola conversación abierta. Devuelve el
 * Set de conversationIds donde el otro participante está escribiendo
 * actualmente, para mostrar el indicador debajo del último mensaje en la lista.
 */
export function useTypingStatusForConversations(conversationIds: string[], currentUserId: string) {
  const [typingConversationIds, setTypingConversationIds] = useState<Set<string>>(new Set());
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (conversationIds.length === 0) return;

    const supabase = createSupabaseBrowserClient();
    const channels = conversationIds.map((conversationId) => {
      const channel = supabase.channel(`typing:${conversationId}`, {
        config: { broadcast: { self: false } },
      });

      channel
        .on("broadcast", { event: TYPING_EVENT }, (payload) => {
          const { userId } = payload.payload as { userId: string };
          if (userId === currentUserId) return;

          setTypingConversationIds((prev) => {
            if (prev.has(conversationId)) return prev;
            const next = new Set(prev);
            next.add(conversationId);
            return next;
          });

          const existingTimeout = timeoutsRef.current.get(conversationId);
          if (existingTimeout) clearTimeout(existingTimeout);

          const timeout = setTimeout(() => {
            setTypingConversationIds((prev) => {
              if (!prev.has(conversationId)) return prev;
              const next = new Set(prev);
              next.delete(conversationId);
              return next;
            });
            timeoutsRef.current.delete(conversationId);
          }, TYPING_TIMEOUT_MS);

          timeoutsRef.current.set(conversationId, timeout);
        })
        .subscribe();

      return channel;
    });

    return () => {
      const timeouts = timeoutsRef.current;
      timeouts.forEach((timeout) => clearTimeout(timeout));
      timeouts.clear();
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
    // conversationIds se compara por contenido serializado para no re-suscribir
    // canales en cada render cuando el array cambia de referencia pero no de contenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationIds.join(","), currentUserId]);

  return typingConversationIds;
}
