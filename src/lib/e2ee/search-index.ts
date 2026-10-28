"use client";

import { listMessagesAction, getSyncHeadsAction, syncConversationAction } from "@/lib/actions/messages";
import {
  deleteConversationSearch,
  deleteSearchDoc,
  getSearchDoc,
  getSearchDocBatch,
  getSearchDocs,
  listSearchMeta,
  putSearchDocs,
  setSearchMeta,
  type SearchDoc,
  type SearchMeta,
} from "@/lib/e2ee/key-store";
import { decryptPayload, decryptWireMessages } from "@/lib/e2ee/messages";
import type { MessageData } from "@/lib/e2ee/message-types";
import { FLAG, normalize, TrigramIndex } from "@/lib/e2ee/search-engine";
import { onIdentityReset } from "@/lib/e2ee/session";
import type { WireMessage } from "@/lib/types/messages";
import type { InboxEvent } from "@/lib/types/realtime";

export { normalize };

/**
 * Búsqueda LOCAL. El servidor no puede buscar en mensajes cifrados, así que cada
 * navegador mantiene lo que ÉL descifró, como hacen Signal o WhatsApp:
 *
 *  - IndexedDB guarda los documentos (persisten entre sesiones; se borran al cerrar sesión).
 *  - Un índice de trigramas EN MEMORIA (search-engine.ts) responde las consultas sin tocar
 *    IndexedDB: se construye por lotes la primera vez que se necesita y luego se mantiene
 *    al día con cada mensaje que llega, se edita o se borra.
 *  - La sincronización con el servidor es incremental: una sola petición ("cabezas" de
 *    todos los chats) y solo se descarga lo que cambió desde la última vez. Ver runSearchIndexer.
 */

const RESULTS_LIMIT = 50;
const META_VERSION = 2;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const BUILD_BATCH = 4000;
/** Separación mínima entre peticiones del indexador: el proxy limita las peticiones por IP. */
const REQUEST_GAP_MS = 400;
const INDEX_CONCURRENCY = 2;

/** Filtros por tipo de contenido (chips de la búsqueda). */
export type SearchFilter = "all" | "links" | "images" | "videos" | "files";

// Detecta enlaces en el texto de un mensaje (sin estado: seguro para `test` repetido).
const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/i;

function fileFlag(mimeType: string): number {
  if (mimeType.startsWith("image/")) return FLAG.IMAGE;
  if (mimeType.startsWith("video/")) return FLAG.VIDEO;
  return FLAG.FILE;
}

const FILE_FILTER_FLAG: Record<Exclude<SearchFilter, "all" | "links">, number> = {
  images: FLAG.IMAGE,
  videos: FLAG.VIDEO,
  files: FLAG.FILE,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

// ---------------------------------------------------------------------------
// Índice en memoria (se alimenta de IndexedDB y se mantiene sincronizado)
// ---------------------------------------------------------------------------

type Engines = {
  messages: TrigramIndex;
  files: TrigramIndex;
  /** Claves de archivo de cada mensaje, para poder retirarlas al editar/borrar. */
  fileKeys: Map<string, string[]>;
};

const enginePromises = new Map<string, Promise<Engines>>();
onIdentityReset(() => {
  enginePromises.clear();
  setStatus({ running: false, done: 0, total: 0 });
});

function removeFromEngines(engines: Engines, messageId: string): void {
  engines.messages.remove(messageId);
  const keys = engines.fileKeys.get(messageId);
  if (keys) {
    keys.forEach((key) => engines.files.remove(key));
    engines.fileKeys.delete(messageId);
  }
}

function addToEngines(engines: Engines, doc: SearchDoc): void {
  removeFromEngines(engines, doc.id);
  const createdAt = Date.parse(doc.createdAt);
  if (doc.text && doc.norm) {
    engines.messages.upsert({
      key: doc.id,
      conversationId: doc.conversationId,
      createdAt,
      norm: doc.norm,
      flags: URL_PATTERN.test(doc.text) ? FLAG.LINK : 0,
    });
  }
  if (doc.files.length > 0) {
    const keys = doc.files.map((file) => `${doc.id}#${file.id}`);
    doc.files.forEach((file, i) =>
      engines.files.upsert({
        key: keys[i],
        conversationId: doc.conversationId,
        createdAt,
        norm: file.norm,
        flags: fileFlag(file.type),
      }),
    );
    engines.fileKeys.set(doc.id, keys);
  }
}

async function buildEngines(ownerId: string): Promise<Engines> {
  const engines: Engines = {
    messages: new TrigramIndex(),
    files: new TrigramIndex(),
    fileKeys: new Map(),
  };
  // Por lotes y cediendo el hilo entre ellos: con decenas de miles de mensajes no congela la interfaz.
  let afterKey: string | null = null;
  for (;;) {
    const batch = await getSearchDocBatch(ownerId, afterKey, BUILD_BATCH);
    if (batch.length === 0) break;
    batch.forEach((doc) => addToEngines(engines, doc));
    afterKey = batch[batch.length - 1].key;
    if (batch.length < BUILD_BATCH) break;
    await sleep(0);
  }
  return engines;
}

/** Construye (una sola vez por sesión) el índice en memoria. Llamarlo antes de buscar es opcional. */
export function warmSearchEngine(ownerId: string): Promise<void> {
  return getEngines(ownerId).then(() => undefined);
}

function getEngines(ownerId: string): Promise<Engines> {
  let pending = enginePromises.get(ownerId);
  if (!pending) {
    pending = buildEngines(ownerId);
    enginePromises.set(ownerId, pending);
    pending.catch(() => {
      if (enginePromises.get(ownerId) === pending) enginePromises.delete(ownerId);
    });
  }
  return pending;
}

/** Aplica un cambio al índice en memoria SI ya existe (si no, se leerá de IndexedDB al crearlo). */
async function mutateEngines(ownerId: string, change: (engines: Engines) => void): Promise<void> {
  const pending = enginePromises.get(ownerId);
  if (!pending) return;
  try {
    change(await pending);
  } catch {
    // La construcción falló: se reintentará en la próxima búsqueda.
  }
}

async function saveDocs(ownerId: string, docs: SearchDoc[]): Promise<void> {
  if (docs.length === 0) return;
  await putSearchDocs(docs);
  await mutateEngines(ownerId, (engines) => docs.forEach((doc) => addToEngines(engines, doc)));
}

/** Retira un mensaje del índice (IndexedDB y memoria). */
export async function removeFromIndex(ownerId: string, messageId: string): Promise<void> {
  await deleteSearchDoc(ownerId, messageId);
  await mutateEngines(ownerId, (engines) => removeFromEngines(engines, messageId));
}

/** Añade o actualiza mensajes ya descifrados; los eliminados salen del índice. */
export async function indexMessages(ownerId: string, messages: MessageData[]): Promise<void> {
  const docs: SearchDoc[] = [];
  for (const message of messages) {
    if (message.deletedAt) {
      await removeFromIndex(ownerId, message.id);
      continue;
    }
    const doc = toSearchDoc(ownerId, message);
    if (doc) docs.push(doc);
  }
  await saveDocs(ownerId, docs);
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

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
/**
 * Consulta efectiva para un filtro: con "Todo" hacen falta ≥2 letras; con un filtro de tipo
 * el texto es opcional (sin texto se listan todos los de ese tipo).
 */
function effectiveQuery(query: string, filter: SearchFilter): string | null {
  const q = normalize(query.trim());
  if (filter === "all") return q.length >= 2 ? q : null;
  return q.length >= 2 ? q : "";
}

/** Entradas de índice que cumplen filtro + texto, en el ámbito dado (más recientes primero). */
function runFilter(
  engines: Engines,
  q: string,
  filter: SearchFilter,
  conversationId: string | undefined,
  limit: number,
) {
  const base = { conversationId, limit };
  if (filter === "all") {
    return { messages: engines.messages.search(q, base), files: engines.files.search(q, base) };
  }
  if (filter === "links") {
    return { messages: engines.messages.search(q, { ...base, flags: FLAG.LINK }), files: [] };
  }
  return { messages: [], files: engines.files.search(q, { ...base, flags: FILE_FILTER_FLAG[filter] }) };
}

const fileRef = (key: string) => {
  const at = key.indexOf("#");
  return { messageId: key.slice(0, at), fileId: key.slice(at + 1) };
};

/** Máximo de coincidencias navegables dentro de un chat. */
const MATCH_LIMIT = 1000;

/**
 * Mensajes de UN chat que coinciden con la búsqueda, del más reciente al más antiguo
 * (para el contador y las flechas ▲▼). Solo ids: no toca IndexedDB.
 */
export async function findMatchingMessages(
  ownerId: string,
  conversationId: string,
  query: string,
  filter: SearchFilter,
): Promise<{ ids: string[]; truncated: boolean }> {
  const q = effectiveQuery(query, filter);
  if (q === null) return { ids: [], truncated: false };

  const engines = await getEngines(ownerId);
  const { messages, files } = runFilter(engines, q, filter, conversationId, MATCH_LIMIT + 1);

  // Un mensaje puede coincidir por su texto y por sus archivos: se cuenta una vez.
  const newest = new Map<string, number>();
  for (const entry of messages) newest.set(entry.key, entry.createdAt);
  for (const entry of files) newest.set(fileRef(entry.key).messageId, entry.createdAt);
  const ordered = [...newest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { ids: ordered.slice(0, MATCH_LIMIT), truncated: ordered.length > MATCH_LIMIT };
}

/** Busca en el índice local. `conversationId` limita la búsqueda a un chat. */
export async function searchLocal(
  ownerId: string,
  query: string,
  conversationId?: string,
  filter: SearchFilter = "all",
): Promise<LocalSearchResults> {
  const q = effectiveQuery(query, filter);
  if (q === null) return { messages: [], files: [] };

  const engines = await getEngines(ownerId);
  const { messages: messageEntries, files: fileEntries } = runFilter(
    engines,
    q,
    filter,
    conversationId,
    RESULTS_LIMIT,
  );

  // Solo los pocos aciertos (máx. RESULTS_LIMIT de cada tipo) se leen de IndexedDB, en una transacción.
  const ids = [...new Set([...messageEntries.map((e) => e.key), ...fileEntries.map((e) => fileRef(e.key).messageId)])];
  const docs = new Map((await getSearchDocs(ownerId, ids)).map((doc) => [doc.id, doc]));

  const messages: SearchMessageHit[] = [];
  for (const entry of messageEntries) {
    const doc = docs.get(entry.key);
    if (!doc?.text) continue;
    messages.push({
      id: doc.id,
      conversationId: doc.conversationId,
      senderUsername: doc.senderUsername,
      content: doc.text,
      createdAt: doc.createdAt,
    });
  }
  const files: SearchFileHit[] = [];
  for (const entry of fileEntries) {
    const { messageId, fileId } = fileRef(entry.key);
    const doc = docs.get(messageId);
    const file = doc?.files.find((f) => f.id === fileId);
    if (!doc || !file) continue;
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
  return { messages, files };
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
        await saveDocs(ownerId, [
          {
            ...doc,
            text: payload.text,
            norm: payload.text ? normalize(payload.text) : "",
          },
        ]);
      } catch {
        // Si no se puede descifrar, mejor no dejar el texto viejo en el índice.
        await removeFromIndex(ownerId, event.messageId);
      }
      return;
    }
    case "message_deleted":
      await removeFromIndex(ownerId, event.messageId);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Estado del indexado (la interfaz muestra "Indexando...")
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

// ---------------------------------------------------------------------------
// Sincronización incremental con el servidor
// ---------------------------------------------------------------------------

type Head = { conversationId: string; latestAt: string | null; changedAt: string | null };

/** ¿Este chat tiene algo pendiente respecto a lo que el índice ya sabe? (ISO se compara como texto). */
export function needsSync(head: Head, meta: SearchMeta | null | undefined): boolean {
  if (!meta || meta.v !== META_VERSION || !meta.complete) return true;
  if (head.latestAt && (!meta.latestAt || head.latestAt > meta.latestAt)) return true;
  if (head.changedAt && (!meta.changedAt || head.changedAt > meta.changedAt)) return true;
  return false;
}

// Un solo "reloj" para todas las peticiones del indexador, aunque haya varios trabajadores.
let nextRequestAt = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_GAP_MS;
  if (wait > 0) await sleep(wait);
}

const metaKey = (ownerId: string, conversationId: string) => `${ownerId}:${conversationId}`;

async function decryptAndIndex(ownerId: string, wire: WireMessage[]): Promise<void> {
  if (wire.length === 0) return;
  await indexMessages(ownerId, await decryptWireMessages(wire));
}

/**
 * Pone al día lo ya indexado: mensajes nuevos desde `meta.latestAt` y ediciones/borrados
 * desde `meta.changedAt` (una petición por página). Devuelve false si hubo demasiados
 * cambios para aplicarlos con seguridad; entonces se reindexa el chat desde cero.
 */
async function syncForward(
  ownerId: string,
  head: Head,
  meta: SearchMeta,
  signal: AbortSignal,
): Promise<boolean> {
  let after = meta.latestAt ?? EPOCH_ISO;
  let changedSince: string | null =
    head.changedAt && (!meta.changedAt || head.changedAt > meta.changedAt)
      ? (meta.changedAt ?? EPOCH_ISO)
      : null;

  for (;;) {
    if (signal.aborted) return true;
    await throttle();
    const result = await syncConversationAction(head.conversationId, after, changedSince);
    if (result.changed?.hasMore) return false;
    if (result.changed) {
      await decryptAndIndex(ownerId, result.changed.messages);
      changedSince = null;
    }
    await decryptAndIndex(ownerId, result.newer.messages);

    const last = result.newer.messages[result.newer.messages.length - 1];
    const advanced = last !== undefined && last.createdAt > after;
    if (last) after = last.createdAt > after ? last.createdAt : after;
    if (!result.newer.hasMore || !advanced) break;
  }

  meta.latestAt = head.latestAt && head.latestAt > after ? head.latestAt : after;
  meta.changedAt = head.changedAt ?? meta.changedAt;
  await setSearchMeta(meta);
  return true;
}

/** Descarga el historial hacia atrás (de lo nuevo a lo viejo) hasta completarlo; reanudable. */
async function backfill(ownerId: string, meta: SearchMeta, signal: AbortSignal): Promise<void> {
  let cursor = meta.oldestCursor ?? undefined;
  for (;;) {
    if (signal.aborted) return;
    await throttle();
    const page = await listMessagesAction(meta.conversationId, cursor);
    await decryptAndIndex(ownerId, page.messages);

    const oldest = page.messages[0];
    if (oldest) meta.oldestCursor = oldest.createdAt;
    if (!page.hasMore || !oldest) {
      meta.complete = true;
      await setSearchMeta(meta);
      return;
    }
    cursor = oldest.createdAt;
    await setSearchMeta(meta); // progreso persistente: si se cierra la pestaña, se reanuda aquí
  }
}

async function resetConversation(ownerId: string, conversationId: string): Promise<void> {
  await deleteConversationSearch(ownerId, conversationId);
  await mutateEngines(ownerId, (engines) => {
    engines.messages.removeConversation(conversationId);
    engines.files.removeConversation(conversationId);
    for (const [messageId, keys] of engines.fileKeys) {
      if (!keys.some((key) => engines.files.has(key))) engines.fileKeys.delete(messageId);
    }
  });
}

function freshMeta(ownerId: string, head: Head): SearchMeta {
  return {
    key: metaKey(ownerId, head.conversationId),
    ownerId,
    conversationId: head.conversationId,
    v: META_VERSION,
    oldestCursor: null,
    complete: head.latestAt === null, // chat vacío: nada que descargar
    latestAt: head.latestAt,
    changedAt: head.changedAt,
  };
}

async function syncConversation(
  ownerId: string,
  head: Head,
  stored: SearchMeta | null,
  signal: AbortSignal,
): Promise<void> {
  let meta = stored;
  if (meta && meta.v !== META_VERSION) {
    await resetConversation(ownerId, head.conversationId); // formato anterior: reindexar una vez
    meta = null;
  }

  if (!meta) {
    meta = freshMeta(ownerId, head);
    await setSearchMeta(meta);
  } else if (needsSync(head, { ...meta, complete: true })) {
    const ok = await syncForward(ownerId, head, meta, signal);
    if (!ok) {
      await resetConversation(ownerId, head.conversationId);
      meta = freshMeta(ownerId, head);
      await setSearchMeta(meta);
    }
  }

  if (!meta.complete && !signal.aborted) await backfill(ownerId, meta, signal);
}

/**
 * Sincroniza el índice local con el servidor.
 *
 * Reposo (nada cambió): UNA petición (las "cabezas" de todos los chats) y cero descargas.
 * Con cambios: solo los chats afectados, y de cada uno solo lo nuevo (desde el último
 * mensaje ya sincronizado) y lo editado/borrado (marcas del servidor, no relojes locales).
 * Chats sin indexar: historial hacia atrás, reanudable, empezando por los más recientes.
 * Seguro de llamar varias veces.
 */
export async function runSearchIndexer(ownerId: string, signal: AbortSignal): Promise<void> {
  if (status.running) return;
  setStatus({ running: true, done: 0, total: 0 });
  try {
    await throttle();
    const heads = await getSyncHeadsAction();
    if (signal.aborted) return;

    const metas = new Map((await listSearchMeta(ownerId)).map((m) => [m.conversationId, m]));

    // Chats de los que ya no soy miembro: su texto no debe seguir en mi índice.
    const current = new Set(heads.map((h) => h.conversationId));
    for (const conversationId of metas.keys()) {
      if (!current.has(conversationId)) await resetConversation(ownerId, conversationId);
    }

    const pending = heads
      .filter((head) => needsSync(head, metas.get(head.conversationId)))
      .sort((a, b) => (b.latestAt ?? "").localeCompare(a.latestAt ?? ""));
    setStatus({ running: true, done: 0, total: pending.length });

    let done = 0;
    const queue = [...pending];
    const worker = async () => {
      for (let head = queue.shift(); head && !signal.aborted; head = queue.shift()) {
        try {
          await syncConversation(ownerId, head, metas.get(head.conversationId) ?? null, signal);
        } catch (error) {
          console.error("[search-index] conversación omitida:", head.conversationId, error);
        }
        done++;
        setStatus({ running: true, done, total: pending.length });
      }
    };
    await Promise.all(Array.from({ length: INDEX_CONCURRENCY }, worker));
  } finally {
    setStatus({ ...status, running: false });
  }
}
