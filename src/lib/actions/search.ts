"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const RESULTS_LIMIT = 30;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

export type SearchMessageHit = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  isGroup: boolean;
  senderUsername: string;
  content: string;
  createdAt: Date;
};

export type SearchFileHit = {
  id: string;
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  isGroup: boolean;
  senderUsername: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: Date;
};

export type SearchResults = {
  messages: SearchMessageHit[];
  files: SearchFileHit[];
};

/**
 * Busca en TODAS las conversaciones del usuario (solo las suyas: el filtro por
 * participación va dentro de la query) mensajes por texto y adjuntos por nombre
 * de archivo. `conversationId` opcional acota la búsqueda a un chat.
 */
export async function searchChatAction(
  query: string,
  conversationId?: string,
): Promise<SearchResults> {
  const session = await getSession();
  if (!session) throw new Error("No autenticado");

  const q = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (q.length < MIN_QUERY_LENGTH) return { messages: [], files: [] };

  const conversationFilter = {
    ...(conversationId ? { id: conversationId } : {}),
    participants: { some: { userId: session.userId } },
  };

  const conversationSelect = {
    select: {
      id: true,
      isGroup: true,
      name: true,
      participants: { select: { userId: true, user: { select: { username: true } } } },
    },
  } as const;

  const [messages, files] = await Promise.all([
    prisma.message.findMany({
      where: {
        deletedAt: null,
        kind: null,
        content: { contains: q, mode: "insensitive" },
        conversation: conversationFilter,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        sender: { select: { username: true } },
        conversation: conversationSelect,
      },
      orderBy: { createdAt: "desc" },
      take: RESULTS_LIMIT,
    }),
    prisma.attachment.findMany({
      where: {
        fileName: { contains: q, mode: "insensitive" },
        message: { deletedAt: null, conversation: conversationFilter },
      },
      select: {
        id: true,
        messageId: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        createdAt: true,
        message: {
          select: {
            sender: { select: { username: true } },
            conversation: conversationSelect,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: RESULTS_LIMIT,
    }),
  ]);

  const titleOf = (c: {
    isGroup: boolean;
    name: string | null;
    participants: { userId: string; user: { username: string } }[];
  }) =>
    c.isGroup
      ? (c.name ?? "Grupo")
      : (c.participants.find((p) => p.userId !== session.userId)?.user.username ?? "Usuario");

  return {
    messages: messages.map((m) => ({
      id: m.id,
      conversationId: m.conversation.id,
      conversationTitle: titleOf(m.conversation),
      isGroup: m.conversation.isGroup,
      senderUsername: m.sender.username,
      content: m.content ?? "",
      createdAt: m.createdAt,
    })),
    files: files.map((f) => ({
      id: f.id,
      messageId: f.messageId,
      conversationId: f.message.conversation.id,
      conversationTitle: titleOf(f.message.conversation),
      isGroup: f.message.conversation.isGroup,
      senderUsername: f.message.sender.username,
      fileName: f.fileName,
      fileType: f.fileType,
      fileSize: f.fileSize,
      createdAt: f.createdAt,
    })),
  };
}
