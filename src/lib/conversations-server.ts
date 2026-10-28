import "server-only";
import { prisma } from "@/lib/prisma";

export type ConversationLastMessage = {
  /** Texto en claro: solo mensajes de sistema o previos al E2EE. */
  content: string | null;
  /** E2EE: el cliente lo descifra para mostrar la vista previa. */
  ciphertext: string | null;
  keyEpoch: number | null;
  senderId: string;
  kind: string | null;
  deleted: boolean;
  hasAttachments: boolean;
  createdAt: Date;
};

export type ConversationItem = {
  id: string;
  isGroup: boolean;
  title: string;
  otherUser: { id: string; username: string } | null;
  members: { id: string; username: string }[];
  lastMessage: ConversationLastMessage | null;
  unreadCount: number;
};

/**
 * Carga las conversaciones de un usuario (todas, o solo `onlyConversationId`)
 * con último mensaje y conteo de no leídos, ordenadas por actividad reciente.
 *
 * El conteo de no leídos va en UNA query SQL agregada (el filtro
 * `createdAt > lastReadAt` es distinto por conversación, así que groupBy de
 * Prisma no sirve). No se usa módulo "use server" a propósito: no valida sesión.
 */
export async function loadConversationItems(
  userId: string,
  onlyConversationId?: string,
): Promise<ConversationItem[]> {
  const participations = await prisma.conversationParticipant.findMany({
    where: { userId, ...(onlyConversationId ? { conversationId: onlyConversationId } : {}) },
    select: {
      conversationId: true,
      conversation: {
        select: {
          isGroup: true,
          name: true,
          participants: {
            select: { userId: true, user: { select: { id: true, username: true } } },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              content: true,
              ciphertext: true,
              keyEpoch: true,
              senderId: true,
              kind: true,
              deletedAt: true,
              createdAt: true,
              _count: { select: { attachments: true } },
            },
          },
        },
      },
    },
  });

  if (participations.length === 0) return [];

  const ids = participations.map((p) => p.conversationId);
  const unreadRows = await prisma.$queryRaw<{ conversationId: string; unreadCount: bigint }[]>`
    SELECT m."conversationId" AS "conversationId", COUNT(*) AS "unreadCount"
    FROM messages m
    INNER JOIN conversation_participants cp
      ON cp."conversationId" = m."conversationId"
      AND cp."userId" = ${userId}
    WHERE m."conversationId" = ANY(${ids})
      AND m."senderId" != ${userId}
      AND (cp."lastReadAt" IS NULL OR m."createdAt" > cp."lastReadAt")
    GROUP BY m."conversationId"
  `;
  const unread = new Map(unreadRows.map((r) => [r.conversationId, Number(r.unreadCount)]));

  const items = participations.map(({ conversationId, conversation }) => {
    const members = conversation.participants.map((p) => p.user);
    const other = conversation.participants.find((p) => p.userId !== userId)?.user;
    const otherUser = conversation.isGroup ? null : (other ?? { id: "", username: "Usuario" });
    const last = conversation.messages[0];
    return {
      id: conversationId,
      isGroup: conversation.isGroup,
      title: conversation.isGroup ? (conversation.name ?? "Grupo") : (otherUser?.username ?? "Usuario"),
      otherUser,
      members,
      lastMessage: last
        ? {
            content: last.content,
            ciphertext: last.ciphertext,
            keyEpoch: last.keyEpoch,
            senderId: last.senderId,
            kind: last.kind,
            deleted: last.deletedAt !== null,
            hasAttachments: last._count.attachments > 0,
            createdAt: last.createdAt,
          }
        : null,
      unreadCount: unread.get(conversationId) ?? 0,
    };
  });

  // Más reciente primero (como WhatsApp); sin mensajes, al final.
  return items.sort(
    (a, b) =>
      (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0),
  );
}


/** Personas con las que `userId` tiene un chat 1:1 (únicas que puede añadir a grupos). */
export async function loadContacts(userId: string) {
  const direct = await prisma.conversationParticipant.findMany({
    where: { userId, conversation: { isGroup: false } },
    select: {
      conversation: {
        select: {
          participants: {
            where: { userId: { not: userId } },
            select: { user: { select: { id: true, username: true } } },
          },
        },
      },
    },
  });

  const byId = new Map<string, { id: string; username: string }>();
  for (const row of direct) {
    for (const p of row.conversation.participants) byId.set(p.user.id, p.user);
  }
  return [...byId.values()].sort((a, b) => a.username.localeCompare(b.username));
}
