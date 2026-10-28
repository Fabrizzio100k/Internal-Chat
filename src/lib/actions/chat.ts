"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/lib/types/chat";
import { checkRateLimit } from "@/lib/rate-limit";
import { loadContacts, loadConversationItems } from "@/lib/conversations-server";
import { findUsersWithoutKeys } from "@/lib/keys-server";
import { MAX_PINNED_CHATS } from "@/lib/conversation-order";
import { MESSAGE_INCLUDE } from "@/lib/messages-server";
import {
  publishToConversation,
  publishToUsersAfter,
  toRealtimeMessage,
} from "@/lib/realtime-server";

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
      isGroup: false,
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
  publishToUsersAfter([toUserId], { type: "request_received" });


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

  publishToUsersAfter([request.fromUserId], {
    type: "conversation_added",
    conversationId: conversation.id,
  });


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

/** Lista las conversaciones del usuario actual (último mensaje + no leídos). */
export async function listConversationsAction() {
  const session = await requireSession();
  return loadConversationItems(session.userId);
}

/** Una sola conversación (para el sidebar en tiempo real). null si no es miembro. */
export async function getConversationItemAction(conversationId: string) {
  const session = await requireSession();
  const [item] = await loadConversationItems(session.userId, conversationId);
  return item ?? null;
}

/**
 * Contactos del usuario: personas con las que ya tiene un chat 1:1. Solo ellas
 * se pueden añadir a un grupo (nadie te mete a un grupo sin conexión previa).
 */
export async function listContactsAction() {
  const session = await requireSession();
  return loadContacts(session.userId);
}

const GROUP_NAME_MAX = 60;
const GROUP_MAX_MEMBERS = 50;

/** Crea un grupo: el creador es ADMIN. Emite un mensaje de sistema en tiempo real. */
export async function createGroupAction(name: string, memberIds: string[]): Promise<ActionResult> {
  const session = await requireSession();

  const trimmedName = name.trim();
  if (!trimmedName) return { success: false, error: "El grupo necesita un nombre" };
  if (trimmedName.length > GROUP_NAME_MAX) {
    return { success: false, error: `El nombre no puede superar ${GROUP_NAME_MAX} caracteres` };
  }

  const uniqueIds = [...new Set(memberIds)].filter((id) => id !== session.userId);
  if (uniqueIds.length === 0) return { success: false, error: "Elige al menos un participante" };
  if (uniqueIds.length + 1 > GROUP_MAX_MEMBERS) {
    return { success: false, error: `Máximo ${GROUP_MAX_MEMBERS} participantes` };
  }

  const allowed = new Set((await loadContacts(session.userId)).map((c) => c.id));
  if (uniqueIds.some((id) => !allowed.has(id))) {
    return { success: false, error: "Solo puedes añadir a personas con las que ya chateas" };
  }

  const missingKeys = await findUsersWithoutKeys([session.userId, ...uniqueIds]);
  if (missingKeys.length > 0) {
    return {
      success: false,
      error: `${missingKeys.join(", ")} aún no activó el cifrado (debe iniciar sesión una vez).`,
    };
  }

  const conversation = await prisma.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        isGroup: true,
        name: trimmedName,
        createdById: session.userId,
        participants: {
          create: [
            { userId: session.userId, role: "ADMIN" as const },
            ...uniqueIds.map((userId) => ({ userId })),
          ],
        },
      },
      select: { id: true },
    });
    // Un solo mensaje de sistema; targetUserIds avisa a TODOS los miembros
    // (sus sidebars lo reciben por Realtime y añaden el grupo al instante).
    const systemMessage = await tx.message.create({
      data: {
        conversationId: created.id,
        senderId: session.userId,
        content: `${session.username} creó el grupo "${trimmedName}"`,
        kind: "group_created",
        targetUserIds: [session.userId, ...uniqueIds],
      },
      include: MESSAGE_INCLUDE,
    });
    return { id: created.id, systemMessage };
  });

  publishToConversation(conversation.id, {
    type: "message",
    message: toRealtimeMessage(conversation.systemMessage),
  });

  return { success: true, conversationId: conversation.id };
}

/**
 * Abre (o crea la primera vez) el chat contigo mismo, "Mensajes guardados": una
 * conversación 1:1 con un único participante. Es idempotente; el lock evita que dos
 * clics/pestañas simultáneas creen dos. Se cifra igual que cualquier chat: la clave
 * se genera en el navegador al enviar el primer mensaje, envuelta solo para ti.
 */
export async function openSelfChatAction(): Promise<ActionResult> {
  const session = await requireSession();

  const conversationId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`self-chat:${session.userId}`}))`;

    const existing = await tx.conversation.findFirst({
      where: {
        isGroup: false,
        participants: { some: { userId: session.userId }, every: { userId: session.userId } },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await tx.conversation.create({
      data: { participants: { create: [{ userId: session.userId }] } },
      select: { id: true },
    });
    return created.id;
  });

  return { success: true, conversationId };
}

/** Fija o desfija un chat para el usuario actual (es una preferencia solo suya). */
export async function setConversationPinnedAction(
  conversationId: string,
  pinned: boolean,
): Promise<ActionResult> {
  const session = await requireSession();

  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
    select: { pinnedAt: true },
  });
  if (!participation) return { success: false, error: "No tienes acceso a esta conversación" };

  if (pinned) {
    if (participation.pinnedAt) return { success: true };
    const count = await prisma.conversationParticipant.count({
      where: { userId: session.userId, pinnedAt: { not: null } },
    });
    if (count >= MAX_PINNED_CHATS) {
      return {
        success: false,
        error: `Solo puedes fijar hasta ${MAX_PINNED_CHATS} chats. Desfija uno primero.`,
      };
    }
  }

  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
    data: { pinnedAt: pinned ? new Date() : null },
  });
  return { success: true };
}

/** Marca una conversación como leída (una sola query; updateMany filtra por pertenencia). */
export async function markConversationReadAction(conversationId: string): Promise<ActionResult> {
  const session = await requireSession();

  const result = await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId: session.userId },
    data: { lastReadAt: new Date() },
  });

  if (result.count === 0) {
    return { success: false, error: "No tienes acceso a esta conversación" };
  }
  return { success: true };
}
