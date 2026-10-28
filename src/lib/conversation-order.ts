/**
 * Orden de la lista de chats (servidor y cliente usan la misma regla):
 * primero los fijados (el fijado más reciente arriba) y luego el resto por
 * actividad reciente. Sin mensajes, la actividad es la fecha de creación del chat.
 * Módulo puro (sin "server-only") para usarlo en el navegador y en pruebas.
 */

/** Máximo de chats que cada usuario puede fijar. */
export const MAX_PINNED_CHATS = 5;

type Sortable = {
  pinnedAt: Date | string | null;
  createdAt: Date | string;
  lastMessage: { createdAt: Date | string } | null;
};

const time = (value: Date | string) => new Date(value).getTime();

export function compareConversations(a: Sortable, b: Sortable): number {
  if (a.pinnedAt && !b.pinnedAt) return -1;
  if (!a.pinnedAt && b.pinnedAt) return 1;
  if (a.pinnedAt && b.pinnedAt) {
    const byPin = time(b.pinnedAt) - time(a.pinnedAt);
    if (byPin !== 0) return byPin;
  }
  return (
    time(b.lastMessage?.createdAt ?? b.createdAt) - time(a.lastMessage?.createdAt ?? a.createdAt)
  );
}

/** Devuelve una copia ordenada (no muta la lista recibida). */
export function sortConversations<T extends Sortable>(items: T[]): T[] {
  return [...items].sort(compareConversations);
}
