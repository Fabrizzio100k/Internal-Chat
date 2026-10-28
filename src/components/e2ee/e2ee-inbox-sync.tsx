"use client";

import { invalidateConversation } from "@/lib/e2ee/conversation-keys";
import { applyInboxEventToIndex } from "@/lib/e2ee/search-index";
import { getActiveIdentity } from "@/lib/e2ee/session";
import { useInboxHandler } from "@/hooks/use-inbox";

/**
 * Se monta una vez en el layout del chat (antes que cualquier ventana de conversación,
 * así su handler corre primero). Hace dos cosas con los eventos en vivo:
 *  1. Si cambió la membresía o la clave de una conversación, descarta su caché de
 *     claves ANTES de que otros componentes intenten descifrar lo que llegue después.
 *  2. Mantiene el índice de búsqueda local al día con cualquier mensaje de cualquier chat.
 */
export function E2eeInboxSync() {
  useInboxHandler((event) => {
    if (event.type === "keys_updated") invalidateConversation(event.conversationId);
    if (event.type === "message" && event.message.kind) {
      invalidateConversation(event.message.conversationId);
    }
    if (event.type === "resync") return;

    const identity = getActiveIdentity();
    if (!identity) return;
    applyInboxEventToIndex(identity.userId, event).catch(() => {});
  });
  return null;
}
