import type { SendErrorCode } from "@/lib/types/messages";

/** Adjunto ya descifrado, tal como lo muestra la interfaz. */
export type AttachmentData = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  /** E2EE: referencia y clave para descifrar el blob. Ausente en adjuntos antiguos en claro. */
  crypto?: { ref: string; key: string };
};

/**
 * Cómo se protegió el mensaje:
 *  - "e2ee": cifrado de extremo a extremo y firma verificada.
 *  - "legacy": anterior al E2EE, en claro en el servidor (se migra solo).
 *  - "undecryptable": no se pudo descifrar/verificar (p. ej. anterior a tu ingreso al grupo).
 */
export type MessageSecurity = "e2ee" | "legacy" | "undecryptable";

export type MessageData = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: string | Date;
  editedAt?: string | Date | null;
  deletedAt?: string | Date | null;
  sender: { id: string; username: string };
  attachments: AttachmentData[];
  /** Mensaje de sistema de grupos ("member_added", "group_renamed", ...). */
  kind?: string | null;
  security?: MessageSecurity;
  /** Motivo legible cuando security === "undecryptable". */
  securityNote?: string;
  /** Enviado optimistamente, pendiente de confirmación del servidor. */
  pending?: boolean;
  /** Llegó en vivo (no del historial): se anima su entrada. */
  isNew?: boolean;
};

/** Contenido que va DENTRO del mensaje cifrado (el servidor nunca lo ve). */
export type PayloadAttachment = {
  ref: string;
  name: string;
  type: string;
  size: number;
  /** Clave AES-256 del archivo, en base64. */
  key: string;
};

export type MessagePayload = {
  v: 1;
  text: string | null;
  attachments?: PayloadAttachment[];
};

export type { SendErrorCode };
