"use client";

import { listConversationsAction } from "@/lib/actions/chat";
import { listMessagesAction } from "@/lib/actions/messages";
import {
  deleteSearchDoc,
  getSearchDoc,
  getSearchMeta,
  hasSearchDoc,
  putSearchDocs,
  scanSearchDocs,
  setSearchMeta,
  type SearchDoc,
} from "@/lib/e2ee/key-store";
import { decryptPayload, decryptWireMessages } from "@/lib/e2ee/messages";
import type { MessageData } from "@/lib/e2ee/message-types";
import type { InboxEvent } from "@/lib/types/realtime";

/**
 * Búsqueda LOCAL. El servidor no puede buscar en mensajes cifrados, así que cada
 * navegador mantiene un índice (IndexedDB) con el texto que ÉL descifró, como hacen
 * Signal o WhatsApp. El índice se llena con los mensajes que llegan y con un proceso
 * en segundo plano que recorre el historial. Se borra al cerrar sesión.
 */

const RESULTS_LIMIT = 30;
const PAGE_DELAY_MS = 400; // el proxy limita las peticiones por IP: no saturarlo

/** Minúsculas y sin acentos, para que "camion" encuentre "Camión". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function toSearchDoc(ownerId: string, message: MessageData): SearchDoc | null {
  if (message.kind || message.deletedAt || message.security === "undecryptable") return null;
  if (message.id.startsWith("tmp-")) return null;
  const text = message.content?.trim() ? message.content : null;
  if (!text && message.attachments.length === 0) return null;
  return {
    key: `${ownerId}:${message.id}`,
    ownerId,
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderUsername: message.sender.username,
    createdAt: new Date(message.createdAt).toISOString(),
    text,
    norm: text ? normalize(text) : "",
    files: message.attachments.map((a) => ({
      id: a.id,
      name: a.fileName,
      type: a.fileType,
      size: a.fileSize,
      norm: normalize(a.fileName),
    })),
  };
}

/** Añade o actualiza mensajes ya descifrados; los eliminados salen del índice. */
export async function indexMessages(ownerId: string, messages: MessageData[]): Promise<void> {
  const docs: SearchDoc[] = [];
  for (const message of messages) {
    if (message.deletedAt) {
      await deleteSearchDoc(ownerId, message.id);
      continue;
    }
    const doc = toSearchDoc(ownerId, message);
    if (doc) docs.push(doc);
  }
  await putSearchDocs(docs);
}

export type SearchMessageHit = {
  id: string;
  conversationId: string;
  senderUsername: string;
  content: string;
  createdAt: string;
};

export type SearchFileHit = {
  id: string;
  messageId: string;
  conversationId: string;
  senderUsername: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
};

export type LocalSearchResults = { messages: SearchMessageHit[]; files: SearchFileHit[] };

/** Busca en el índice local. `conversationId` limita la búsqueda a un chat. */
export async function searchLocal(
  ownerId: string,
  query: string,
  conversationId?: string,
): Promise<LocalSearchResults> {
  const q = normalize(query.trim());
  if (q.length < 2) return { messages: [], files: [] };

  const messages: SearchMessageHit[] = [];
  const files: SearchFileHit[] = [];
  await scanSearchDocs(ownerId, conversationId, (doc) => {
    if (doc.text && doc.norm.includes(q)) {
      messages.push({
        id: doc.id,
        conversationId: doc.conversationId,
        senderUsername: doc.senderUsername,
        content: doc.text,
        createdAt: doc.createdAt,
      });
    }
    for (const file of doc.files) {
      if (file.norm.includes(q)) {
        files.push({
          id: file.id,
          messageId: doc.id,
          conversationId: doc.conversationId,
          senderUsername: doc.senderUsername,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          createdAt: doc.createdAt,
        });
      }
    }
  });

  const newestFirst = <T extends { createdAt: string }>(a: T, b: T) =>
    b.createdAt.localeCompare(a.createdAt);
  return {
    messages: messages.sort(newestFirst).slice(0, RESULTS_LIMIT),
    files: files.sort(newestFirst).slice(0, RESULTS_LIMIT),
  };
}

// ---------------------------------------------------------------------------
// Mantenimiento en vivo: eventos del inbox
// ---------------------------------------------------------------------------

/** Mantiene el índice al día con lo que llega por tiempo real (cualquier conversación). */
export async function applyInboxEventToIndex(ownerId: string, event: InboxEvent): Promise<void> {
  switch (event.type) {
    case "message":
    case "message_migrated": {
      const [message] = await decryptWireMessages([event.message]);
      await indexMessages(ownerId, [message]);
      return;
    }
    case "message_updated": {
      const doc = await getSearchDoc(ownerId, event.messageId);
      if (!doc) return;
      try {
        const payload = await decryptPayload(
          event.conversationId,
          doc.senderId,
          event.ciphertext,
          event.keyEpoch,
        );
        await putSearchDocs([
          {
            ...doc,
            text: payload.text,
            norm: payload.text ? normalize(payload.text) : "",
          },
        ]);
      } catch {
        // Si no se puede descifrar, mejor no dejar el texto viejo en el índice.
        await deleteSearchDoc(ownerId, event.messageId);
      }
      return;
    }
    case "message_deleted":
      await deleteSearchDoc(ownerId, event.messageId);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Indexado del historial en segundo plano
// ---------------------------------------------------------------------------

export type IndexStatus = { running: boolean; done: number; total: number };

let status: IndexStatus = { running: false, done: 0, total: 0 };
const listeners = new Set<(s: IndexStatus) => void>();

function setStatus(next: IndexStatus): void {
  status = next;
  listeners.forEach((listener) => listener(status));
}

export function getIndexStatus(): IndexStatus {
  return status;
}

export function subscribeIndexStatus(listener: (s: IndexStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function indexConversation(
  ownerId: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<void> {
  const meta = await getSearchMeta(ownerId, conversationId);
  let oldestCursor = meta?.oldestCursor ?? null;
  let complete = meta?.complete ?? false;

  // Fase 1: desde lo más nuevo hacia atrás hasta toparnos con lo ya indexado.
  // Fase 2 (si el historial estaba a medias): continuar desde donde se quedó.
  let cursor: string | undefined;
  let phase: 1 | 2 = 1;
  for (;;) {
    if (signal.aborted) return;
    const page = await listMessagesAction(conversationId, cursor);
    const known = await Promise.all(page.messages.map((m) => hasSearchDoc(ownerId, m.id)));
    const decrypted = await decryptWireMessages(page.messages);
    await indexMessages(ownerId, decrypted);

    const first = page.messages[0];
    if (phase === 2 || !meta) {
      // Seguimos avanzando hacia atrás: guardar el progreso.
      if (first) oldestCursor = first.createdAt;
    }

    if (!page.hasMore || !first) {
      complete = true;
      break;
    }

    const indexable = page.messages.filter((m) => !m.kind);
    const overlapped =
      phase === 1 &&
      indexable.length > 0 &&
      indexable.every((m) => known[page.messages.indexOf(m)]);

    if (overlapped) {
      if (complete) break; // todo el historial ya estaba indexado
      // Reanudar el historial pendiente desde el cursor guardado.
      if (!oldestCursor) break;
      phase = 2;
      cursor = oldestCursor;
    } else {
      cursor = first.createdAt;
    }

    await setSearchMeta({
      key: `${ownerId}:${conversationId}`,
      ownerId,
      conversationId,
      oldestCursor,
      complete,
    });
    await sleep(PAGE_DELAY_MS);
  }

  await setSearchMeta({
    key: `${ownerId}:${conversationId}`,
    ownerId,
    conversationId,
    oldestCursor,
    complete,
  });
}

/** Recorre todas mis conversaciones y completa el índice. Seguro de llamar varias veces. */
export async function runSearchIndexer(ownerId: string, signal: AbortSignal): Promise<void> {
  if (status.running) return;
  try {
    const conversations = await listConversationsAction();
    setStatus({ running: true, done: 0, total: conversations.length });
    let done = 0;
    for (const conversation of conversations) {
      if (signal.aborted) break;
      try {
        await indexConversation(ownerId, conversation.id, signal);
      } catch (error) {
        console.error("[search-index] conversación omitida:", conversation.id, error);
      }
      done++;
      setStatus({ running: true, done, total: conversations.length });
      await sleep(PAGE_DELAY_MS);
    }
  } finally {
    setStatus({ ...status, running: false });
  }
}
