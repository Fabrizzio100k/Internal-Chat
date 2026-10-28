import "server-only";
import { prisma } from "@/lib/prisma";
import {
  MAX_CIPHERTEXT_LENGTH,
  MESSAGES_PAGE_SIZE,
  type ListMessagesResult,
  type SendErrorCode,
  type WireMessage,
} from "@/lib/types/messages";

// IMPORTANTE: este módulo NO es "use server" a propósito. Las funciones de aquí
// no validan pertenencia a la conversación; si fueran Server Actions quedarían
// expuestas como endpoints públicos. Solo se llaman desde código servidor que
// YA validó al usuario (la página de conversación y listMessagesAction).

export const MESSAGE_INCLUDE = {
  sender: { select: { id: true, username: true } },
  attachments: {
    // Nunca se expone storagePath: la descarga siempre pasa por /api/upload/[id].
    select: {
      id: true,
      ref: true,
      encSize: true,
      fileName: true,
      fileType: true,
      fileSize: true,
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

const include = MESSAGE_INCLUDE;

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  ciphertext: string | null;
  keyEpoch: number | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  kind: string | null;
  targetUserIds: string[];
  sender: { id: string; username: string };
  attachments: {
    id: string;
    ref: string | null;
    encSize: number | null;
    fileName: string | null;
    fileType: string | null;
    fileSize: number | null;
  }[];
};

/** Convierte una fila de Prisma al formato de red (fechas ISO, sin storagePath). */
export function toWireMessage(m: MessageRow): WireMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    content: m.content,
    ciphertext: m.ciphertext,
    keyEpoch: m.keyEpoch,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    kind: m.kind,
    targetUserIds: m.targetUserIds,
    sender: m.sender,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      ref: a.ref,
      encSize: a.encSize,
      fileName: a.fileName,
      fileType: a.fileType,
      fileSize: a.fileSize,
    })),
  };
}

/**
 * Valida que el ciphertext tenga forma de base64 razonable y que la época sea la
 * vigente. El servidor NO puede (ni intenta) leer el contenido: solo comprueba
 * tamaño y que el cliente cifró con la clave actual de la conversación.
 */
export async function validateEncryptedPayload(
  conversationId: string,
  ciphertext: unknown,
  keyEpoch: unknown,
): Promise<{ ok: true } | { ok: false; error: string; code?: SendErrorCode }> {
  if (typeof ciphertext !== "string" || ciphertext.length < 40) {
    return { ok: false, error: "Mensaje inválido" };
  }
  if (ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
    return { ok: false, error: "El mensaje es demasiado largo" };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    return { ok: false, error: "Mensaje inválido" };
  }
  if (typeof keyEpoch !== "number" || !Number.isInteger(keyEpoch) || keyEpoch < 1) {
    return { ok: false, error: "Época de clave inválida" };
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { currentEpoch: true, keyRotationPending: true },
  });
  if (!conversation || conversation.currentEpoch === 0) {
    return {
      ok: false,
      error: "Esta conversación aún no tiene cifrado activo",
      code: "no_keys",
    };
  }
  if (conversation.keyRotationPending) {
    return {
      ok: false,
      error: "Hay que renovar la clave de la conversación",
      code: "rotation_pending",
    };
  }
  if (keyEpoch !== conversation.currentEpoch) {
    return {
      ok: false,
      error: "La clave de la conversación cambió. Reintenta.",
      code: "stale_epoch",
    };
  }
  return { ok: true };
}

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

  return { messages: trimmed.reverse().map(toWireMessage), hasMore };
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
  return { messages: [...olderAsc, ...newer].map(toWireMessage), hasMore };
}

// ---------------------------------------------------------------------------
// Sincronización del índice de búsqueda local
// ---------------------------------------------------------------------------

export const SYNC_PAGE_SIZE = 200;

/**
 * "Cabezas" de cada conversación del usuario: fecha del último mensaje y de la última
 * edición/borrado. Con ellas el cliente sabe qué chats cambiaron desde su última
 * sincronización SIN pedir nada más (en reposo: una sola petición para todo).
 * Cada dato sale de un índice (conversationId, createdAt|editedAt|deletedAt) con LIMIT 1,
 * así que el coste es O(chats), no O(mensajes).
 */
export async function loadSyncHeads(userId: string): Promise<
  { conversationId: string; latestAt: string | null; changedAt: string | null }[]
> {
  const rows = await prisma.$queryRaw<
    { conversationId: string; latestAt: Date | null; changedAt: Date | null }[]
  >`
    SELECT
      cp."conversationId" AS "conversationId",
      (SELECT m."createdAt" FROM messages m
        WHERE m."conversationId" = cp."conversationId"
        ORDER BY m."createdAt" DESC LIMIT 1) AS "latestAt",
      GREATEST(
        (SELECT m."editedAt" FROM messages m
          WHERE m."conversationId" = cp."conversationId" AND m."editedAt" IS NOT NULL
          ORDER BY m."editedAt" DESC LIMIT 1),
        (SELECT m."deletedAt" FROM messages m
          WHERE m."conversationId" = cp."conversationId" AND m."deletedAt" IS NOT NULL
          ORDER BY m."deletedAt" DESC LIMIT 1)
      ) AS "changedAt"
    FROM conversation_participants cp
    WHERE cp."userId" = ${userId}
  `;
  return rows.map((row) => ({
    conversationId: row.conversationId,
    latestAt: row.latestAt?.toISOString() ?? null,
    changedAt: row.changedAt?.toISOString() ?? null,
  }));
}

/** Mensajes creados desde `after` (inclusive), del más antiguo al más nuevo. */
export async function listMessagesAfterUnchecked(
  conversationId: string,
  after: Date,
): Promise<ListMessagesResult> {
  const rows = await prisma.message.findMany({
    where: { conversationId, createdAt: { gte: after } },
    include,
    orderBy: { createdAt: "asc" },
    take: SYNC_PAGE_SIZE + 1,
  });
  const hasMore = rows.length > SYNC_PAGE_SIZE;
  return { messages: (hasMore ? rows.slice(0, SYNC_PAGE_SIZE) : rows).map(toWireMessage), hasMore };
}

/**
 * Mensajes editados o eliminados después de `since`. `hasMore` = hay más cambios de los
 * que caben en una página: el cliente prefiere reindexar el chat entero antes que arriesgar un hueco.
 */
export async function listChangedMessagesUnchecked(
  conversationId: string,
  since: Date,
): Promise<ListMessagesResult> {
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      OR: [{ editedAt: { gt: since } }, { deletedAt: { gt: since } }],
    },
    include,
    orderBy: { createdAt: "asc" },
    take: SYNC_PAGE_SIZE + 1,
  });
  const hasMore = rows.length > SYNC_PAGE_SIZE;
  return { messages: (hasMore ? rows.slice(0, SYNC_PAGE_SIZE) : rows).map(toWireMessage), hasMore };
}
