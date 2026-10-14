"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  type ListMessagesResult,
  type SendMessageResult,
  type EditMessageResult,
  type DeleteMessageResult,
} from "@/lib/types/messages";
import { listMessagesPageUnchecked, MESSAGE_INCLUDE } from "@/lib/messages-server";
import { publishToConversation, toRealtimeMessage } from "@/lib/realtime-server";
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
 * Los mensajes se devuelven en orden ascendente (más antiguo primero) listos para renderizar.
 */
export async function listMessagesAction(
  conversationId: string,
  cursor?: string,
): Promise<ListMessagesResult> {
  const session = await requireSession();
  await assertParticipant(conversationId, session.userId);
  return listMessagesPageUnchecked(conversationId, cursor);
}

/** Envía un mensaje de texto a una conversación. La notificación en vivo la hace Supabase Realtime. */
export async function sendMessageAction(
  conversationId: string,
  content: string,
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

  const trimmed = content.trim();
  if (!trimmed) {
    return { success: false, error: "El mensaje no puede estar vacío" };
  }
  if (trimmed.length > 5000) {
    return { success: false, error: "El mensaje es demasiado largo" };
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: session.userId,
      content: trimmed,
    },
    include: MESSAGE_INCLUDE,
  });

  // Tiempo real: se publica a los participantes después de responder (after()).
  publishToConversation(conversationId, {
    type: "message",
    message: toRealtimeMessage(message),
  });

  return { success: true, messageId: message.id };
}

/**
 * Edita el contenido de un mensaje propio. Solo el autor puede editarlo, y
 * solo si no fue eliminado. Marca `editedAt` para que la UI pueda mostrar
 * la etiqueta "(editado)". No se permite editar mensajes que son solo
 * adjuntos (sin contenido de texto).
 */
export async function editMessageAction(
  messageId: string,
  content: string,
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

  const trimmed = content.trim();
  if (!trimmed) {
    return { success: false, error: "El mensaje no puede estar vacío" };
  }
  if (trimmed.length > 5000) {
    return { success: false, error: "El mensaje es demasiado largo" };
  }

  const editedAt = new Date();
  await prisma.message.update({
    where: { id: messageId },
    data: { content: trimmed, editedAt },
  });

  publishToConversation(message.conversationId, {
    type: "message_updated",
    conversationId: message.conversationId,
    messageId,
    content: trimmed,
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
    data: { content: null, deletedAt },
  });

  publishToConversation(message.conversationId, {
    type: "message_deleted",
    conversationId: message.conversationId,
    messageId,
    deletedAt: deletedAt.toISOString(),
  });

  return { success: true };
}
