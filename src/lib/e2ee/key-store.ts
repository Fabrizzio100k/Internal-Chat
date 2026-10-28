"use client";

/**
 * Almacén local (IndexedDB) del E2EE. Todo lo que está aquí vive SOLO en este
 * navegador:
 *  - identity: las claves privadas del usuario como CryptoKey NO extraíbles (el
 *    JavaScript de la página puede usarlas pero no leerlas ni exportarlas).
 *  - pins: claves públicas de otras personas ya vistas (TOFU) para detectar cambios.
 *  - search / searchMeta: índice local de búsqueda (texto descifrado de mis mensajes).
 * Al cerrar sesión se borran identity, search y searchMeta (los pins se conservan).
 */

const DB_NAME = "internal-chat-e2ee";
const DB_VERSION = 1;

export type StoredIdentity = {
  userId: string;
  ecdhPrivate: CryptoKey;
  signPrivate: CryptoKey;
  ecdhPublicKey: string;
  signPublicKey: string;
};

export type StoredPin = {
  key: string; // `${ownerId}:${peerId}`
  ownerId: string;
  peerId: string;
  ecdhPublicKey: string;
  signPublicKey: string;
  /** El usuario comparó el número de seguridad por otro canal. */
  verified: boolean;
  pinnedAt: number;
};

export type SearchDoc = {
  key: string; // `${ownerId}:${messageId}`
  ownerId: string;
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername: string;
  createdAt: string;
  /** Texto del mensaje (null si solo tenía archivos). */
  text: string | null;
  /** Texto normalizado (minúsculas, sin acentos) para comparar rápido. */
  norm: string;
  files: { id: string; name: string; type: string; size: number; norm: string }[];
};

export type SearchMeta = {
  key: string; // `${ownerId}:${conversationId}`
  ownerId: string;
  conversationId: string;
  /** createdAt del mensaje más antiguo ya indexado (cursor para seguir hacia atrás). */
  oldestCursor: string | null;
  /** Ya se indexó todo el historial hacia atrás. */
  complete: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB no disponible"));
  }
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("identity", { keyPath: "userId" });
      db.createObjectStore("pins", { keyPath: "key" });
      const search = db.createObjectStore("search", { keyPath: "key" });
      search.createIndex("byOwner", "ownerId");
      search.createIndex("byConversation", ["ownerId", "conversationId"]);
      const meta = db.createObjectStore("searchMeta", { keyPath: "key" });
      meta.createIndex("byOwner", "ownerId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// --- identidad ---------------------------------------------------------------

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  await wrap((await store("identity", "readwrite")).put(identity));
}

export async function loadIdentity(userId: string): Promise<StoredIdentity | null> {
  const found = await wrap((await store("identity", "readonly")).get(userId));
  return (found as StoredIdentity | undefined) ?? null;
}

// --- pins (TOFU) --------------------------------------------------------------

export async function getPin(ownerId: string, peerId: string): Promise<StoredPin | null> {
  const found = await wrap((await store("pins", "readonly")).get(`${ownerId}:${peerId}`));
  return (found as StoredPin | undefined) ?? null;
}

export async function setPin(
  ownerId: string,
  peerId: string,
  keys: { ecdhPublicKey: string; signPublicKey: string },
  verified = false,
): Promise<void> {
  const pin: StoredPin = {
    key: `${ownerId}:${peerId}`,
    ownerId,
    peerId,
    ...keys,
    verified,
    pinnedAt: Date.now(),
  };
  await wrap((await store("pins", "readwrite")).put(pin));
}

// --- índice de búsqueda -----------------------------------------------------

export async function putSearchDocs(docs: SearchDoc[]): Promise<void> {
  if (docs.length === 0) return;
  const db = await openDb();
  const tx = db.transaction("search", "readwrite");
  const s = tx.objectStore("search");
  for (const doc of docs) s.put(doc);
  await done(tx);
}

export async function deleteSearchDoc(ownerId: string, messageId: string): Promise<void> {
  await wrap((await store("search", "readwrite")).delete(`${ownerId}:${messageId}`));
}

export async function hasSearchDoc(ownerId: string, messageId: string): Promise<boolean> {
  const found = await wrap((await store("search", "readonly")).getKey(`${ownerId}:${messageId}`));
  return found !== undefined;
}

/** Recorre los documentos del usuario (opcionalmente de una conversación). */
export async function scanSearchDocs(
  ownerId: string,
  conversationId: string | undefined,
  visit: (doc: SearchDoc) => void,
): Promise<void> {
  const s = await store("search", "readonly");
  const range = conversationId
    ? IDBKeyRange.only([ownerId, conversationId])
    : IDBKeyRange.only(ownerId);
  const index = s.index(conversationId ? "byConversation" : "byOwner");
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      visit(cursor.value as SearchDoc);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getSearchMeta(
  ownerId: string,
  conversationId: string,
): Promise<SearchMeta | null> {
  const found = await wrap(
    (await store("searchMeta", "readonly")).get(`${ownerId}:${conversationId}`),
  );
  return (found as SearchMeta | undefined) ?? null;
}

export async function setSearchMeta(meta: SearchMeta): Promise<void> {
  await wrap((await store("searchMeta", "readwrite")).put(meta));
}

// --- limpieza -----------------------------------------------------------------

/** Cierre de sesión: borra claves privadas e índice de búsqueda de este navegador. */
export async function wipeLocalSecrets(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(["identity", "search", "searchMeta"], "readwrite");
    tx.objectStore("identity").clear();
    tx.objectStore("search").clear();
    tx.objectStore("searchMeta").clear();
    await done(tx);
  } catch {
    // Sin IndexedDB no hay nada que borrar.
  }
}

export async function getSearchDoc(ownerId: string, messageId: string): Promise<SearchDoc | null> {
  const found = await wrap((await store("search", "readonly")).get(`${ownerId}:${messageId}`));
  return (found as SearchDoc | undefined) ?? null;
}
