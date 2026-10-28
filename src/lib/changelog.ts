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
    version: "0.5.0",
    date: "2026-10-28",
    title: "Cierre de sesión remoto al instante",
    highlights: [
      "En Ajustes → Dispositivos puedes cerrar la sesión de cualquier otro dispositivo, y ahora surte efecto al instante: ese dispositivo sale solo y borra las claves de cifrado que guardaba.",
      "Cerrar todas las demás sesiones pide una confirmación antes de ejecutarse.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-28",
    title: "Ajustes en un solo lugar",
    highlights: [
      "Nuevo engranaje de Ajustes: cuenta y cierre de sesión, apariencia, dispositivos y novedades en una sola ventana.",
      "Apariencia: elige entre claro, oscuro o automático (sigue a tu sistema).",
      "La barra superior queda más limpia: el cambio de tema y el cierre de sesión ahora viven en Ajustes.",
      "También puedes abrir Ajustes tocando tu nombre o avatar, y desde la pantalla de apps.",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-10-28",
    title: "Ir al último mensaje y eliminar cuenta",
    highlights: [
      "Al subir por el historial aparece un botón abajo a la derecha para volver al mensaje más reciente (con el número de mensajes nuevos que llegaron mientras tanto).",
      "Nueva sección «Cuenta» (abajo a la derecha de la lista de chats) para eliminar tu cuenta y todos tus datos, con confirmación escrita y tu contraseña.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-28",
    title: "Búsqueda integrada y nuevo diseño",
    highlights: [
      "Buscar ya no abre una ventana: dentro del chat se despliega una barra con filtros por enlaces, imágenes, videos y archivos, contador de coincidencias y flechas para saltar entre ellas.",
      "Las coincidencias se resaltan directamente en los mensajes (Ctrl/Cmd + F abre la búsqueda del chat).",
      "La búsqueda general ahora vive en la barra lateral, con los mismos filtros.",
      "Interfaz renovada con tonos azules y celestes, tipografía del sistema, esquinas más suaves y efecto de vidrio, también en modo oscuro.",
    ],
  },
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
