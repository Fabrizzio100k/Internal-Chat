"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  MESSAGE_INCLUDE,
  toWireMessage,
  validateEncryptedPayload,
} from "@/lib/messages-server";
import { publishToConversation } from "@/lib/realtime-server";
import { deleteStoredObject, isValidAttachmentRef, MAX_ENCRYPTED_FILE_BYTES, verifyUploadedObject } from "@/lib/storage";
import type { SendErrorCode, WireMessage } from "@/lib/types/messages";

/**
 * Migración al E2EE de mensajes y archivos ANTERIORES (en claro). El servidor no
 * puede cifrarlos (no tiene las claves), así que cada usuario migra los SUYOS desde
 * su navegador: descarga el contenido antiguo, lo cifra y lo reemplaza. Al terminar,
 * `content`/`fileName` quedan en null y el archivo original se borra de S3.
 */

const BATCH_SIZE = 20;

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("No autenticado");
  return session;
}

const legacyOwnWhere = (userId: string) => ({
  senderId: userId,
  kind: null,
  deletedAt: null,
  ciphertext: null,
  OR: [{ content: { not: null } }, { attachments: { some: { ref: null } } }],
});

/** Próximo lote de mis mensajes en claro por migrar (y cuántos faltan en total). */
export async function listLegacyOwnMessagesAction(excludeConversationIds: string[] = []): Promise<{
  messages: WireMessage[];
  remaining: number;
}> {
  const session = await requireSession();
  const exclude = Array.isArray(excludeConversationIds)
    ? excludeConversationIds.filter((id) => typeof id === "string").slice(0, 200)
    : [];
  const where = {
    ...legacyOwnWhere(session.userId),
    ...(exclude.length > 0 ? { conversationId: { notIn: exclude } } : {}),
  };
  const [rows, remaining] = await Promise.all([
    prisma.message.findMany({
      where,
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    }),
    prisma.message.count({ where }),
  ]);
  return { messages: rows.map(toWireMessage), remaining };
}

export type MigrateAttachmentInput = { id: string; ref: string; encSize: number };

export type MigrateMessageResult = {
  success: boolean;
  error?: string;
  code?: SendErrorCode;
};

/**
 * Reemplaza un mensaje propio en claro por su versión cifrada. Los adjuntos antiguos
 * apuntan ahora al blob cifrado (subido antes con /api/upload/presign) y se borra el
 * objeto original en claro.
 */
export async function migrateMessageAction(input: {
  messageId: string;
  ciphertext: string;
  keyEpoch: number;
  attachments: MigrateAttachmentInput[];
}): Promise<MigrateMessageResult> {
  const session = await requireSession();

  const message = await prisma.message.findUnique({
    where: { id: input.messageId },
    include: { attachments: true },
  });
  if (
    !message ||
    message.senderId !== session.userId ||
    message.kind ||
    message.deletedAt ||
    message.ciphertext !== null
  ) {
    return { success: false, error: "Este mensaje no se puede migrar" };
  }

  const check = await validateEncryptedPayload(message.conversationId, input.ciphertext, input.keyEpoch);
  if (!check.ok) return { success: false, error: check.error, code: check.code };

  const legacy = message.attachments.filter((a) => a.ref === null);
  const incoming = Array.isArray(input.attachments) ? input.attachments : [];
  if (
    incoming.length !== legacy.length ||
    !legacy.every((a) => incoming.some((i) => i.id === a.id))
  ) {
    return { success: false, error: "Los adjuntos no coinciden" };
  }
  for (const a of incoming) {
    if (
      !isValidAttachmentRef(a.ref) ||
      typeof a.encSize !== "number" ||
      !Number.isInteger(a.encSize) ||
      a.encSize <= 0 ||
      a.encSize > MAX_ENCRYPTED_FILE_BYTES
    ) {
      return { success: false, error: "Adjunto inválido" };
    }
  }

  const verified = await Promise.all(
    incoming.map((a) => verifyUploadedObject(`${message.conversationId}/${a.ref}`, a.encSize)),
  );
  if (verified.some((ok) => !ok)) {
    return { success: false, error: "No se pudo verificar un archivo cifrado" };
  }

  const oldPaths = legacy.map((a) => a.storagePath);
  const updated = await prisma.$transaction(async (tx) => {
    for (const a of incoming) {
      await tx.attachment.update({
        where: { id: a.id },
        data: {
          storagePath: `${message.conversationId}/${a.ref}`,
          ref: a.ref,
          encSize: a.encSize,
          fileName: null,
          fileType: null,
          fileSize: null,
        },
      });
    }
    return tx.message.update({
      where: { id: message.id },
      data: { content: null, ciphertext: input.ciphertext, keyEpoch: input.keyEpoch },
      include: MESSAGE_INCLUDE,
    });
  });

  // El original en claro ya no debe existir en S3 (best effort).
  await Promise.all(oldPaths.map((path) => deleteStoredObject(path)));

  publishToConversation(message.conversationId, {
    type: "message_migrated",
    conversationId: message.conversationId,
    message: toWireMessage(updated),
  });
  return { success: true };
}
