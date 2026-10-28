import "server-only";
import { prisma } from "@/lib/prisma";
import { sortConversations } from "@/lib/conversation-order";

export const SELF_CHAT_TITLE = "Mensajes guardados";

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
  /** Chat contigo mismo ("Mensajes guardados"): un solo participante, tú. */
  isSelf: boolean;
  title: string;
  otherUser: { id: string; username: string; avatar?: string | null } | null;
  members: { id: string; username: string; avatar?: string | null }[];
  lastMessage: ConversationLastMessage | null;
  unreadCount: number;
  /** Fecha en que ESTE usuario fijó el chat; null si no está fijado. */
  pinnedAt: Date | null;
  createdAt: Date;
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
      pinnedAt: true,
      conversation: {
        select: {
          createdAt: true,
          isGroup: true,
          name: true,
          participants: {
            select: {
              userId: true,
              user: { select: { id: true, username: true, avatar: true } },
            },
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

  const items = participations.map(({ conversationId, conversation, pinnedAt }) => {
    const members = conversation.participants.map((p) => p.user);
    const other = conversation.participants.find((p) => p.userId !== userId)?.user;
    // Chat 1:1 sin "otra persona" = chat contigo mismo.
    const isSelf = !conversation.isGroup && !other;
    const otherUser = conversation.isGroup || isSelf ? null : (other ?? { id: "", username: "Usuario" });
    const last = conversation.messages[0];
    return {
      id: conversationId,
      isGroup: conversation.isGroup,
      isSelf,
      title: conversation.isGroup
        ? (conversation.name ?? "Grupo")
        : isSelf
          ? SELF_CHAT_TITLE
          : (otherUser?.username ?? "Usuario"),
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
      pinnedAt,
      createdAt: conversation.createdAt,
    };
  });

  // Fijados primero; luego el más reciente primero (como WhatsApp).
  return sortConversations(items);
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
            select: { user: { select: { id: true, username: true, avatar: true } } },
          },
        },
      },
    },
  });

  const byId = new Map<string, { id: string; username: string; avatar: string | null }>();
  for (const row of direct) {
    for (const p of row.conversation.participants) byId.set(p.user.id, p.user);
  }
  return [...byId.values()].sort((a, b) => a.username.localeCompare(b.username));
}
