"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types/chat";
import { checkRateLimit } from "@/lib/rate-limit";

// Spam de solicitudes de chat: máximo 10 solicitudes por hora por IP.
const CHAT_REQUEST_RATE_LIMIT = 10;
const CHAT_REQUEST_RATE_WINDOW_MS = 60 * 60 * 1000;

async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("No autenticado");
  }
  return session;
}

/** Busca usuarios por username (excluye al usuario actual). */
export async function searchUsersAction(query: string) {
  const session = await requireSession();

  if (!query.trim()) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      username: { contains: query.trim(), mode: "insensitive" },
      id: { not: session.userId },
    },
    select: { id: true, username: true },
    take: 10,
  });

  return users;
}

/** Envía una solicitud de chat a otro usuario. */
export async function sendChatRequestAction(toUserId: string): Promise<ActionResult> {
  const session = await requireSession();

  const rateLimit = await checkRateLimit(
    "send-chat-request",
    CHAT_REQUEST_RATE_LIMIT,
    CHAT_REQUEST_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return {
      success: false,
      error: `Demasiadas solicitudes enviadas. Intenta de nuevo en ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minuto(s).`,
    };
  }

  if (toUserId === session.userId) {
    return { success: false, error: "No puedes enviarte una solicitud a ti mismo" };
  }

  const toUser = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!toUser) {
    return { success: false, error: "Usuario no encontrado" };
  }

  // Si ya existe una conversación entre ambos, no tiene sentido otra solicitud.
  const existingConversation = await prisma.conversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: session.userId } } },
        { participants: { some: { userId: toUserId } } },
      ],
    },
  });
  if (existingConversation) {
    return { success: false, error: "Ya tienes una conversación con este usuario" };
  }

  const existingRequest = await prisma.chatRequest.findFirst({
    where: {
      OR: [
        { fromUserId: session.userId, toUserId },
        { fromUserId: toUserId, toUserId: session.userId },
      ],
      status: "PENDING",
    },
  });
  if (existingRequest) {
    return { success: false, error: "Ya existe una solicitud pendiente con este usuario" };
  }

  await prisma.chatRequest.create({
    data: { fromUserId: session.userId, toUserId },
  });

  revalidatePath("/chat");
  return { success: true };
}

/** Acepta una solicitud de chat: crea la conversación con ambos participantes. */
export async function acceptChatRequestAction(requestId: string): Promise<ActionResult> {
  const session = await requireSession();

  const request = await prisma.chatRequest.findUnique({ where: { id: requestId } });
  if (!request || request.toUserId !== session.userId) {
    return { success: false, error: "Solicitud no encontrada" };
  }
  if (request.status !== "PENDING") {
    return { success: false, error: "Esta solicitud ya fue procesada" };
  }

  const conversation = await prisma.$transaction(async (tx) => {
    await tx.chatRequest.update({
      where: { id: requestId },
      data: { status: "ACCEPTED" },
    });

    const newConversation = await tx.conversation.create({ data: {} });

    await tx.conversationParticipant.createMany({
      data: [
        { conversationId: newConversation.id, userId: request.fromUserId },
        { conversationId: newConversation.id, userId: request.toUserId },
      ],
    });

    return newConversation;
  });

  revalidatePath("/chat");
  return { success: true, conversationId: conversation.id };
}

/** Rechaza una solicitud de chat. */
export async function rejectChatRequestAction(requestId: string): Promise<ActionResult> {
  const session = await requireSession();

  const request = await prisma.chatRequest.findUnique({ where: { id: requestId } });
  if (!request || request.toUserId !== session.userId) {
    return { success: false, error: "Solicitud no encontrada" };
  }
  if (request.status !== "PENDING") {
    return { success: false, error: "Esta solicitud ya fue procesada" };
  }

  await prisma.chatRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED" },
  });

  revalidatePath("/chat");
  return { success: true };
}

/** Lista las solicitudes pendientes recibidas por el usuario actual. */
export async function listPendingRequestsAction() {
  const session = await requireSession();

  return prisma.chatRequest.findMany({
    where: { toUserId: session.userId, status: "PENDING" },
    include: { fromUser: { select: { id: true, username: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Lista las conversaciones del usuario actual, con el último mensaje y el
 * conteo de mensajes no leídos (mensajes de la conversación creados después
 * de mi lastReadAt y que no envié yo mismo).
 */
export async function listConversationsAction() {
  const session = await requireSession();

  const myParticipations = await prisma.conversationParticipant.findMany({
    where: { userId: session.userId },
    include: {
      conversation: {
        include: {
          participants: {
            include: { user: { select: { id: true, username: true } } },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: { conversation: { createdAt: "desc" } },
  });

  const results = await Promise.all(
    myParticipations.map(async (participation) => {
      const { conversation } = participation;
      const otherParticipant = conversation.participants.find((p) => p.userId !== session.userId);

      const unreadCount = await prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: session.userId },
          ...(participation.lastReadAt ? { createdAt: { gt: participation.lastReadAt } } : {}),
        },
      });

      return {
        id: conversation.id,
        otherUser: otherParticipant?.user ?? { id: "", username: "Usuario" },
        lastMessage: conversation.messages[0] ?? null,
        unreadCount,
      };
    }),
  );

  return results;
}

/**
 * Marca una conversación como leída para el usuario actual, actualizando
 * su lastReadAt en ConversationParticipant al momento actual. Debe llamarse
 * al abrir/entrar a la conversación.
 */
export async function markConversationReadAction(conversationId: string): Promise<ActionResult> {
  const session = await requireSession();

  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
  });

  if (!participation) {
    return { success: false, error: "No tienes acceso a esta conversación" };
  }

  await prisma.conversationParticipant.update({
    where: { id: participation.id },
    data: { lastReadAt: new Date() },
  });

  return { success: true };
}
