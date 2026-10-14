import "server-only";
import { prisma } from "@/lib/prisma";
import { MESSAGES_PAGE_SIZE, type ListMessagesResult } from "@/lib/types/messages";

// IMPORTANTE: este módulo NO es "use server" a propósito. Las funciones de aquí
// no validan pertenencia a la conversación; si fueran Server Actions quedarían
// expuestas como endpoints públicos. Solo se llaman desde código servidor que
// YA validó al usuario (la página de conversación y listMessagesAction).

export const MESSAGE_INCLUDE = {
  sender: { select: { id: true, username: true } },
  attachments: true,
} as const;

const include = MESSAGE_INCLUDE;

async function fetchMessagesPage(conversationId: string, cursor?: string, limit = MESSAGES_PAGE_SIZE) {
  return prisma.message.findMany({
    where: {
      conversationId,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    include,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
}

/** Página de historial en orden ascendente (más antiguo primero). */
export async function listMessagesPageUnchecked(
  conversationId: string,
  cursor?: string,
): Promise<ListMessagesResult> {
  const page = await fetchMessagesPage(conversationId, cursor);
  const hasMore = page.length > MESSAGES_PAGE_SIZE;
  const trimmed = hasMore ? page.slice(0, MESSAGES_PAGE_SIZE) : page;

  return { messages: trimmed.reverse(), hasMore };
}

/**
 * Ventana de mensajes alrededor de uno concreto (para "ir al mensaje" desde la
 * búsqueda): 25 anteriores + el mensaje + todos los posteriores. Si hay más de
 * 150 posteriores devuelve null y la página cae a la vista normal (últimos
 * mensajes), para no dejar un hueco entre la ventana y el tiempo real.
 */
export async function listMessagesAroundUnchecked(
  conversationId: string,
  messageId: string,
): Promise<ListMessagesResult | null> {
  const target = await prisma.message.findFirst({
    where: { id: messageId, conversationId },
    select: { createdAt: true },
  });
  if (!target) return null;

  const [newer, older] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId, createdAt: { gte: target.createdAt } },
      include,
      orderBy: { createdAt: "asc" },
      take: 151,
    }),
    prisma.message.findMany({
      where: { conversationId, createdAt: { lt: target.createdAt } },
      include,
      orderBy: { createdAt: "desc" },
      take: 26,
    }),
  ]);

  if (newer.length > 150) return null;

  const hasMore = older.length > 25;
  const olderAsc = (hasMore ? older.slice(0, 25) : older).reverse();
  return { messages: [...olderAsc, ...newer], hasMore };
}
