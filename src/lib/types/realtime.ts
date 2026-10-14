// Eventos que el servidor publica en el "inbox" privado de cada usuario.
// Solo viajan hacia los participantes de la conversación afectada.

export type RealtimeMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Mensaje de sistema de grupos ("member_added", ...) o null. */
  kind: string | null;
  targetUserIds: string[];
  sender: { id: string; username: string };
  attachments: { id: string; fileName: string; fileType: string; fileSize: number }[];
};

export type InboxEvent =
  | { type: "message"; message: RealtimeMessage }
  | {
      type: "message_updated";
      conversationId: string;
      messageId: string;
      content: string;
      editedAt: string;
    }
  | { type: "message_deleted"; conversationId: string; messageId: string; deletedAt: string }
  | { type: "conversation_added"; conversationId: string }
  | { type: "request_received" }
  // Sintético (lo genera el cliente al reconectar): hay que re-sincronizar.
  | { type: "resync" };

export const INBOX_EVENT_NAME = "inbox";
