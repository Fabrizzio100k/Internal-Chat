export const MESSAGES_PAGE_SIZE = 50;

/**
 * Adjunto tal como viaja por la red. En adjuntos cifrados (E2EE) `fileName`,
 * `fileType` y `fileSize` son null: el nombre, tipo y clave reales van dentro del
 * mensaje cifrado, ligados por `ref`.
 */
export type WireAttachment = {
  id: string;
  ref: string | null;
  encSize: number | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
};

/**
 * Mensaje tal como lo ve el servidor y la red: el contenido está en `ciphertext`.
 * `content` solo trae texto en claro para mensajes de sistema (kind != null) y
 * para mensajes anteriores al E2EE que todavía no se migraron.
 */
export type WireMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  ciphertext: string | null;
  keyEpoch: number | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Mensaje de sistema de grupos ("member_added", ...) o null. */
  kind: string | null;
  targetUserIds: string[];
  sender: { id: string; username: string };
  attachments: WireAttachment[];
};

export type ListMessagesResult = {
  messages: WireMessage[];
  hasMore: boolean;
};

/** Códigos para que el cliente reaccione (refrescar claves, rotar, reintentar). */
export type SendErrorCode = "stale_epoch" | "rotation_pending" | "no_keys";

export type SendMessageResult = {
  success: boolean;
  error?: string;
  code?: SendErrorCode;
  messageId?: string;
};

export type EditMessageResult = {
  success: boolean;
  error?: string;
  code?: SendErrorCode;
};

export type DeleteMessageResult = {
  success: boolean;
  error?: string;
};

/** Límite del ciphertext (base64) por mensaje: texto de 5000 caracteres + metadatos de 10 adjuntos. */
export const MAX_CIPHERTEXT_LENGTH = 120_000;
