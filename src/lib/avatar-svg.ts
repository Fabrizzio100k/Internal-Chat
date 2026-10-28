import { createAvatar } from "@dicebear/core";
import type { Style } from "@dicebear/core";
import { bottts, funEmoji, pixelArt, thumbs } from "@dicebear/collection";
import { ANIMALS } from "@/lib/avatar-animals";
import type { AvatarSpec, AvatarStyleId } from "@/lib/avatar";

// Estilo propio con el mismo mecanismo de DiceBear: la semilla elige el animal; el fondo lo pone DiceBear.
const animalsStyle: Style<object> = {
  meta: {
    title: "Animales",
    creator: "Twitter, Inc. y colaboradores (Twemoji)",
    source: "https://github.com/twitter/twemoji",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  },
  create: ({ prng }) => {
    const animal = ANIMALS[prng.integer(0, ANIMALS.length - 1)];
    return {
      attributes: { viewBox: "0 0 36 36", fill: "none", "shape-rendering": "auto" },
      body: `<g transform="translate(4 4) scale(0.78)">${animal.body}</g>`,
    };
  },
};

const STYLES: Record<AvatarStyleId, Style<object>> = {
  animals: animalsStyle,
  emoji: funEmoji as Style<object>,
  robots: bottts as Style<object>,
  pixel: pixelArt as Style<object>,
  thumbs: thumbs as Style<object>,
};

// Fondos pastel que se ven bien en claro y oscuro.
const BACKGROUNDS = [
  "b6e3f4",
  "c0aede",
  "d1d4f9",
  "ffd5dc",
  "ffdfbf",
  "c1f0c8",
  "fde68a",
  "a7f3d0",
  "fbcfe8",
  "bae6fd",
];

const MAX_CACHED = 500;
const cache = new Map<string, string>();

/** Imagen (data URI SVG) del avatar. Se genera en el momento y se guarda en memoria. */
export function avatarDataUri({ style, seed }: AvatarSpec): string {
  const key = `${style}:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const svg = createAvatar(STYLES[style], {
    seed,
    backgroundColor: BACKGROUNDS,
    backgroundType: ["solid"],
  }).toString();
  // Sin el bloque <metadata> (cada avatar pesaría ~600 bytes más); los créditos van en Ajustes.
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/<metadata[\s\S]*?<\/metadata>/, ""))}`;

  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, uri);
  return uri;
}
