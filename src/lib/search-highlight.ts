/**
 * Localiza las coincidencias de una búsqueda DENTRO del texto original de un mensaje, para
 * resaltarlas. La búsqueda ignora mayúsculas y acentos ("camion" encuentra "Camión"), pero
 * normalizar un texto cambia sus posiciones; por eso se pliega carácter a carácter guardando
 * a qué posición original corresponde cada carácter plegado. Módulo puro (sin DOM).
 */

type Folded = { norm: string; starts: number[]; ends: number[] };

function fold(text: string): Folded {
  let norm = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i) as number;
    const char = String.fromCodePoint(codePoint);
    const next = i + char.length;
    const folded = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < folded.length; k++) {
      starts.push(i);
      ends.push(next);
    }
    norm += folded;
    i = next;
  }
  return { norm, starts, ends };
}

/** Rangos [inicio, fin) en `text` donde aparece `normalizedQuery` (ya plegada), sin solaparse. */
export function findMatchRanges(text: string, normalizedQuery: string): [number, number][] {
  if (!normalizedQuery) return [];
  const { norm, starts, ends } = fold(text);
  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = norm.indexOf(normalizedQuery, from);
    if (at === -1) break;
    const last = at + normalizedQuery.length - 1;
    ranges.push([starts[at], ends[last]]);
    from = at + normalizedQuery.length;
  }
  return ranges;
}
