"use client";

import { E2eeError, decryptMessagePayload, encryptMessagePayload } from "@/lib/e2ee/crypto";
import {
  KeyChangedError,
  MissingKeysError,
  getConversationState,
  getFreshState,
  getSendingKey,
} from "@/lib/e2ee/conversation-keys";
import type {
  AttachmentData,
  MessageData,
  MessagePayload,
} from "@/lib/e2ee/message-types";
import { requireIdentity } from "@/lib/e2ee/session";
import type { WireMessage } from "@/lib/types/messages";

/** Texto legible para errores del E2EE (se muestra en toasts). */
export function describeE2eeError(error: unknown): string {
  if (error instanceof KeyChangedError) {
    return `La clave de cifrado de ${error.username} cambió. Verifica su identidad antes de continuar.`;
  }
  if (error instanceof MissingKeysError) return error.message;
  if (error instanceof E2eeError) {
    if (error.code === "missing-key") return "No tienes la clave de esta conversación.";
    return error.message;
  }
  return "No se pudo completar la operación de cifrado.";
}

/** Cifra y firma un payload con la clave vigente de la conversación. */
export async function encryptPayload(
  conversationId: string,
  payload: MessagePayload,
): Promise<{ ciphertext: string; keyEpoch: number }> {
  const me = requireIdentity();
  const { epoch, key } = await getSendingKey(conversationId);
  const ciphertext = await encryptMessagePayload(
    key,
    me.signPrivate,
    { conversationId, epoch, senderId: me.userId },
    payload,
  );
  return { ciphertext, keyEpoch: epoch };
}

/** Descifra y verifica el contenido de un mensaje cifrado. Lanza E2eeError si falla. */
export async function decryptPayload(
  conversationId: string,
  senderId: string,
  ciphertext: string,
  keyEpoch: number,
): Promise<MessagePayload> {
  let state = await getConversationState(conversationId);
  if (keyEpoch > state.bundle.currentEpoch || !state.signKeys.has(senderId)) {
    state = await getFreshState(conversationId);
  }
  const key = state.epochKeys.get(keyEpoch);
  if (!key) throw new E2eeError("missing-key", "Sin clave para esta época");
  const senderKey = state.signKeys.get(senderId);
  if (!senderKey) throw new E2eeError("bad-signature", "Remitente sin clave de firma");
  const payload = await decryptMessagePayload<MessagePayload>(
    key,
    senderKey,
    { conversationId, epoch: keyEpoch, senderId },
    ciphertext,
  );
  if (!payload || payload.v !== 1) throw new E2eeError("bad-ciphertext", "Formato desconocido");
  return payload;
}

function undecryptableReason(error: unknown): string {
  if (error instanceof KeyChangedError) {
    return `La clave de ${error.username} cambió. Revisa su verificación de seguridad.`;
  }
  if (error instanceof E2eeError && error.code === "missing-key") {
    return "Mensaje anterior a tu ingreso a la conversación.";
  }
  if (error instanceof E2eeError && error.code === "bad-signature") {
    return "No se pudo verificar quién envió este mensaje.";
  }
  return "No se pudo descifrar este mensaje.";
}

/** Convierte un mensaje de red (cifrado) en lo que muestra la interfaz. Nunca lanza. */
export async function decryptWireMessage(wire: WireMessage): Promise<MessageData> {
  const base = {
    id: wire.id,
    conversationId: wire.conversationId,
    senderId: wire.senderId,
    createdAt: wire.createdAt,
    editedAt: wire.editedAt,
    deletedAt: wire.deletedAt,
    sender: wire.sender,
    kind: wire.kind,
  };

  // Mensajes de sistema: texto en claro por diseño (metadatos de membresía).
  if (wire.kind) return { ...base, content: wire.content, attachments: [] };
  if (wire.deletedAt) return { ...base, content: null, attachments: [] };

  if (wire.ciphertext === null || wire.keyEpoch === null) {
    // Anterior al E2EE: sigue en claro hasta que su autor lo migre.
    return {
      ...base,
      content: wire.content,
      attachments: wire.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName ?? "archivo",
        fileType: a.fileType ?? "application/octet-stream",
        fileSize: a.fileSize ?? a.encSize ?? 0,
      })),
      security: "legacy",
    };
  }

  try {
    const payload = await decryptPayload(
      wire.conversationId,
      wire.senderId,
      wire.ciphertext,
      wire.keyEpoch,
    );
    const attachments: AttachmentData[] = [];
    for (const a of wire.attachments) {
      const meta = payload.attachments?.find((p) => p.ref === a.ref);
      if (!meta || !a.ref) continue;
      attachments.push({
        id: a.id,
        fileName: meta.name,
        fileType: meta.type,
        fileSize: meta.size,
        crypto: { ref: meta.ref, key: meta.key },
      });
    }
    return { ...base, content: payload.text, attachments, security: "e2ee" };
  } catch (error) {
    return {
      ...base,
      content: null,
      attachments: [],
      security: "undecryptable",
      securityNote: undecryptableReason(error),
    };
  }
}

export function decryptWireMessages(wires: WireMessage[]): Promise<MessageData[]> {
  return Promise.all(wires.map(decryptWireMessage));
}

/** Vista previa de una línea (sidebar) a partir del último mensaje de una conversación. */
export async function decryptPreview(
  conversationId: string,
  last: {
    content: string | null;
    ciphertext: string | null;
    keyEpoch: number | null;
    senderId: string;
    kind: string | null;
    deleted: boolean;
    hasAttachments: boolean;
  },
): Promise<string> {
  if (last.kind) return last.content ?? "";
  if (last.deleted) return "Mensaje eliminado";
  if (last.ciphertext === null || last.keyEpoch === null) {
    return last.content ?? (last.hasAttachments ? "Archivo adjunto" : "");
  }
  try {
    const payload = await decryptPayload(conversationId, last.senderId, last.ciphertext, last.keyEpoch);
    if (payload.text) return payload.text;
    return last.hasAttachments ? "Archivo adjunto" : "";
  } catch {
    return "🔒 Mensaje cifrado";
  }
}
