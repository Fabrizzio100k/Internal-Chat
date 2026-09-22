"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  MESSAGES_PAGE_SIZE,
  type ListMessagesResult,
  type SendMessageResult,
  type EditMessageResult,
  type DeleteMessageResult,
} from "@/lib/types/messages";
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

async function fetchMessagesPage(conversationId: string, cursor?: string, limit = MESSAGES_PAGE_SIZE) {
  return prisma.message.findMany({
    where: {
      conversationId,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    include: {
      sender: { select: { id: true, username: true } },
      attachments: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
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

/**
 * Igual que listMessagesAction pero sin repetir la validación de pertenencia.
 * Solo debe llamarse desde código server-side que YA validó que el usuario
 * pertenece a la conversación (p. ej. la página de conversación, que necesita
 * los datos de la conversación de todos modos para mostrar el otro usuario).
 */
export async function listMessagesPageUnchecked(
  conversationId: string,
  cursor?: string,
): Promise<ListMessagesResult> {
  const page = await fetchMessagesPage(conversationId, cursor);
  const hasMore = page.length > MESSAGES_PAGE_SIZE;
  const trimmed = hasMore ? page.slice(0, MESSAGES_PAGE_SIZE) : page;

  return {
    messages: trimmed.reverse(),
    hasMore,
  };
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
  });

  revalidatePath(`/chat/${conversationId}`);
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
  if (!message || message.deletedAt) {
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

  await prisma.message.update({
    where: { id: messageId },
    data: { content: trimmed, editedAt: new Date() },
  });

  revalidatePath(`/chat/${message.conversationId}`);
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
  if (!message || message.deletedAt) {
    return { success: false, error: "El mensaje no existe" };
  }
  if (message.senderId !== session.userId) {
    return { success: false, error: "No puedes eliminar este mensaje" };
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { content: null, deletedAt: new Date() },
  });

  revalidatePath(`/chat/${message.conversationId}`);
  return { success: true };
}
