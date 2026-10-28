/**
 * Avatares generados (nada de imágenes guardadas): un avatar es solo "<estilo>:<semilla>".
 * La misma pareja produce siempre el mismo dibujo (ver avatar-svg.ts).
 *
 * Este módulo es puro (sin DiceBear) para poder validar en el servidor y en pruebas.
 */

export const AVATAR_STYLES = [
  { id: "animals", label: "Animales" },
  { id: "emoji", label: "Emoji" },
  { id: "robots", label: "Robots" },
  { id: "pixel", label: "Pixel" },
  { id: "thumbs", label: "Caritas" },
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLES)[number]["id"];

export type AvatarSpec = { style: AvatarStyleId; seed: string };

const STYLE_IDS: readonly string[] = AVATAR_STYLES.map((s) => s.id);

// Estilo por defecto según el username: los animales salen más seguido que el resto.
const DEFAULT_STYLE_POOL: readonly AvatarStyleId[] = [
  "animals",
  "animals",
  "animals",
  "emoji",
  "robots",
  "pixel",
  "thumbs",
];

/** Formato válido de lo que se guarda en la base: estilo conocido + semilla alfanumérica corta. */
const STORED_AVATAR = /^([a-z]+):([a-z0-9]{1,24})$/;

/** FNV-1a de 32 bits: estable entre servidor y navegador. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Interpreta el valor guardado; devuelve null si no es un avatar válido. */
export function parseAvatar(value: string | null | undefined): AvatarSpec | null {
  if (!value) return null;
  const match = STORED_AVATAR.exec(value);
  if (!match || !STYLE_IDS.includes(match[1])) return null;
  return { style: match[1] as AvatarStyleId, seed: match[2] };
}

export function serializeAvatar(spec: AvatarSpec): string {
  return `${spec.style}:${spec.seed}`;
}

/** Avatar a mostrar: el elegido, o uno derivado del username (siempre el mismo para esa persona). */
export function resolveAvatar(username: string, avatar: string | null | undefined): AvatarSpec {
  const chosen = parseAvatar(avatar);
  if (chosen) return chosen;
  const style = DEFAULT_STYLE_POOL[hashString(username) % DEFAULT_STYLE_POOL.length];
  return { style, seed: username };
}

/** Semilla aleatoria para el botón "Barajar" (minúsculas y dígitos, cabe en la validación). */
export function randomAvatarSeed(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(4, "0");
}
