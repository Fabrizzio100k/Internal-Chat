// Eventos que el servidor publica en el "inbox" privado de cada usuario.
// Solo viajan hacia los participantes de la conversación afectada. Los mensajes
// van cifrados de extremo a extremo: ni este canal ni Supabase ven el contenido.

import type { WireMessage } from "@/lib/types/messages";

export type RealtimeMessage = WireMessage;

export type InboxEvent =
  | { type: "message"; message: RealtimeMessage }
  | {
      type: "message_updated";
      conversationId: string;
      messageId: string;
      ciphertext: string;
      keyEpoch: number;
      editedAt: string;
    }
  | { type: "message_deleted"; conversationId: string; messageId: string; deletedAt: string }
  // Un mensaje antiguo en claro fue cifrado por su autor: reemplaza la versión anterior.
  | { type: "message_migrated"; conversationId: string; message: RealtimeMessage }
  // Cambió la clave de la conversación (miembro nuevo/salió, rotación): re-pedir el bundle.
  | { type: "keys_updated"; conversationId: string }
  | { type: "conversation_added"; conversationId: string }
  | { type: "request_received" }
  // Una conversación ya no existe para mí (la otra persona eliminó su cuenta).
  | { type: "conversation_removed"; conversationId: string }
  // Sintético (lo genera el cliente al reconectar): hay que re-sincronizar.
  | { type: "resync" };

export const INBOX_EVENT_NAME = "inbox";
