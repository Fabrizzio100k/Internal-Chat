import { compareVersions } from "@/lib/version";

/**
 * Historial de versiones ("qué hay de nuevo"). Al subir la versión de package.json
 * (`npm version minor|patch --no-git-tag-version`) hay que añadir aquí su entrada: una
 * prueba falla si la versión actual no tiene entrada. Más reciente primero.
 *
 * `silent: true` = la versión aparece en el historial pero NO abre el popup (para
 * arreglos menores que no vale la pena anunciar).
 */
export type ChangelogEntry = {
  version: string;
  /** AAAA-MM-DD */
  date: string;
  title: string;
  highlights: string[];
  silent?: boolean;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.2.0",
    date: "2026-10-28",
    title: "Más control y búsqueda más rápida",
    highlights: [
      "Mensajes guardados: escríbete notas y guarda archivos a ti mismo, también cifrados.",
      "Fija hasta 5 chats arriba de la lista (clic derecho o mantén pulsado).",
      "Dispositivos: mira dónde tienes la sesión abierta y ciérrala en cualquiera.",
      "La búsqueda local ahora es mucho más rápida y se mantiene al día al editar o borrar mensajes.",
      "Número de versión y novedades en la parte baja de la lista de chats.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-21",
    title: "Primera versión",
    highlights: [
      "Chats 1:1 y grupos con cifrado de extremo a extremo.",
      "Archivos adjuntos cifrados y búsqueda de mensajes en tu dispositivo.",
    ],
    silent: true,
  },
];

/** Entrada de una versión concreta (o undefined si no está en el historial). */
export function findEntry(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((entry) => entry.version === version);
}

/**
 * Entradas que el usuario aún no vio: mayores que `lastSeen` y hasta `current`,
 * más reciente primero. Sin `lastSeen` (cuenta anterior a este sistema) solo se
 * anuncia la versión actual. Las entradas `silent` no cuentan para el popup.
 */
export function unseenEntries(
  lastSeen: string | null | undefined,
  current: string,
  entries: ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  return entries
    .filter((entry) => !entry.silent)
    .filter((entry) => compareVersions(entry.version, current) <= 0)
    .filter((entry) =>
      lastSeen ? compareVersions(entry.version, lastSeen) > 0 : entry.version === current,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}
