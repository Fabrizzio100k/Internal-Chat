"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  type ListMessagesResult,
  type SendMessageResult,
  type EditMessageResult,
  type DeleteMessageResult,
} from "@/lib/types/messages";
import {
  listMessagesPageUnchecked,
  listMessagesAfterUnchecked,
  listChangedMessagesUnchecked,
  loadSyncHeads,
  MESSAGE_INCLUDE,
  toWireMessage,
  validateEncryptedPayload,
} from "@/lib/messages-server";
import { publishToConversation } from "@/lib/realtime-server";
import { checkRateLimit } from "@/lib/rate-limit";

// Spam de mensajes: máximo 20 mensajes por minuto por IP.
const SEND_MESSAGE_RATE_LIMIT = 20;
const SEND_MESSAGE_RATE_WINDOW_MS = 60 * 1000;

async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("No autenticado");
  }
  return session;
}

async function assertParticipant(conversationId: string, userId: string) {
  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });

  if (!participation) {
    throw new Error("No tienes acceso a esta conversación");
  }

  return participation;
}

/**
 * Lista el historial de mensajes de una conversación, paginado.
 * Sin `cursor`: devuelve los MESSAGES_PAGE_SIZE (50) mensajes más recientes.
 * Con `cursor` (ISO date del mensaje más antiguo ya cargado): devuelve los
 * siguientes 50 mensajes anteriores a esa fecha (para "cargar más" al scrollear arriba).
 * Los mensajes se devuelven en orden ascendente (más antiguo primero) y CIFRADOS:
 * el navegador los descifra.
 */
export async function listMessagesAction(
  conversationId: string,
  cursor?: string,
): Promise<ListMessagesResult> {
  const session = await requireSession();
  await assertParticipant(conversationId, session.userId);
  return listMessagesPageUnchecked(conversationId, cursor);
}

/**
 * Cabezas de todas mis conversaciones (último mensaje y última edición/borrado) para
 * decidir en el cliente qué chats necesitan sincronizar el índice de búsqueda.
 */
export async function getSyncHeadsAction() {
  const session = await requireSession();
  return loadSyncHeads(session.userId);
}

export type SyncConversationResult = {
  /** Mensajes nuevos desde `after` (inclusive). */
  newer: ListMessagesResult;
  /** Mensajes editados/eliminados desde `changedSince`; null si no se pidió. */
  changed: ListMessagesResult | null;
};

/**
 * Una sola petición para poner al día un chat ya indexado: lo nuevo y lo modificado.
 * Fechas ISO tal como las devolvió el servidor (nunca relojes del cliente).
 */
export async function syncConversationAction(
  conversationId: string,
  after: string,
  changedSince: string | null,
): Promise<SyncConversationResult> {
  const session = await requireSession();
  await assertParticipant(conversationId, session.userId);

  const afterDate = new Date(after);
  const sinceDate = changedSince ? new Date(changedSince) : null;
  if (Number.isNaN(afterDate.getTime()) || (sinceDate && Number.isNaN(sinceDate.getTime()))) {
    throw new Error("Fecha inválida");
  }

  const [newer, changed] = await Promise.all([
    listMessagesAfterUnchecked(conversationId, afterDate),
    sinceDate ? listChangedMessagesUnchecked(conversationId, sinceDate) : Promise.resolve(null),
  ]);
  return { newer, changed };
}

/**
 * Envía un mensaje YA CIFRADO por el cliente. El servidor lo guarda tal cual y lo
 * reenvía a los participantes; no tiene la clave para leerlo.
 */
export async function sendMessageAction(
  conversationId: string,
  ciphertext: string,
  keyEpoch: number,
): Promise<SendMessageResult> {
  const session = await requireSession();
  await assertParticipant(conversationId, session.userId);

  const rateLimit = await checkRateLimit(
    "send-message",
    SEND_MESSAGE_RATE_LIMIT,
    SEND_MESSAGE_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Estás enviando mensajes muy rápido. Espera ${rateLimit.retryAfterSeconds} segundos.`,
    };
  }

  const check = await validateEncryptedPayload(conversationId, ciphertext, keyEpoch);
  if (!check.ok) return { success: false, error: check.error, code: check.code };

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: session.userId,
      ciphertext,
      keyEpoch,
    },
    include: MESSAGE_INCLUDE,
  });

  // Tiempo real: se publica a los participantes después de responder (after()).
  publishToConversation(conversationId, {
    type: "message",
    message: toWireMessage(message),
  });

  return { success: true, messageId: message.id };
}

/**
 * Reemplaza el contenido cifrado de un mensaje propio. Solo el autor puede
 * editarlo, y solo si no fue eliminado. Marca `editedAt` para que la UI pueda
 * mostrar "(editado)". No se permite editar mensajes con adjuntos.
 */
export async function editMessageAction(
  messageId: string,
  ciphertext: string,
  keyEpoch: number,
): Promise<EditMessageResult> {
  const session = await requireSession();

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { attachments: { select: { id: true } } },
  });
  if (!message || message.deletedAt || message.kind) {
    return { success: false, error: "El mensaje no existe" };
  }
  if (message.senderId !== session.userId) {
    return { success: false, error: "No puedes editar este mensaje" };
  }
  if (message.attachments.length > 0) {
    return { success: false, error: "No se pueden editar mensajes con archivos adjuntos" };
  }

  const check = await validateEncryptedPayload(message.conversationId, ciphertext, keyEpoch);
  if (!check.ok) return { success: false, error: check.error, code: check.code };

  const editedAt = new Date();
  // Si era un mensaje antiguo en claro, al editarlo queda cifrado (content = null).
  await prisma.message.update({
    where: { id: messageId },
    data: { ciphertext, keyEpoch, content: null, editedAt },
  });

  publishToConversation(message.conversationId, {
    type: "message_updated",
    conversationId: message.conversationId,
    messageId,
    ciphertext,
    keyEpoch,
    editedAt: editedAt.toISOString(),
  });

  return { success: true };
}

/**
 * Elimina (soft delete) un mensaje propio. Se conserva la fila en la base
 * de datos con `deletedAt` marcado y el contenido limpiado, en vez de un
 * DELETE físico, para que el otro participante vea el placeholder
 * "Mensaje eliminado" tal como hacen apps de mensajería estándar.
 */
export async function deleteMessageAction(messageId: string): Promise<DeleteMessageResult> {
  const session = await requireSession();

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt || message.kind) {
    return { success: false, error: "El mensaje no existe" };
  }
  if (message.senderId !== session.userId) {
    return { success: false, error: "No puedes eliminar este mensaje" };
  }

  const deletedAt = new Date();
  await prisma.message.update({
    where: { id: messageId },
    data: { content: null, ciphertext: null, deletedAt },
  });

  publishToConversation(message.conversationId, {
    type: "message_deleted",
    conversationId: message.conversationId,
    messageId,
    deletedAt: deletedAt.toISOString(),
  });

  return { success: true };
}
