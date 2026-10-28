/**
 * Motor de búsqueda en memoria: índice invertido de TRIGRAMAS (fragmentos de 3 letras).
 *
 * Por qué: la versión anterior leía de IndexedDB y recorría TODOS los mensajes en cada
 * tecla (O(N) con deserialización). Aquí cada consulta intersecta las listas de trigramas
 * de lo escrito (ordenadas por id), lo que descarta casi todo el corpus sin tocarlo, y solo
 * los pocos candidatos restantes se verifican con `includes` (así "camion" sigue encontrando
 * "camiones", igual que antes). Coste típico: O(candidatos), no O(mensajes).
 *
 * Es un módulo puro (sin IndexedDB ni React) para poder probarlo contra un oráculo de
 * fuerza bruta. Los ids internos ("slots") solo crecen, así las listas siguen ordenadas
 * al añadir; los borrados dejan una lápida y se compacta cuando hay demasiadas.
 */

/** Minúsculas y sin acentos, para que "camion" encuentre "Camión". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Etiquetas de una entrada para filtrar por tipo (máscara de bits). */
export const FLAG = {
  LINK: 1,
  IMAGE: 2,
  VIDEO: 4,
  /** Archivo que no es imagen ni video (documentos, audio, etc.). */
  FILE: 8,
} as const;

export type EngineEntry = {
  /** Clave única (id del mensaje, o `${mensaje}#${archivo}` para archivos). */
  key: string;
  conversationId: string;
  /** Milisegundos desde epoch: se ordena por el más reciente. */
  createdAt: number;
  /** Texto ya normalizado. */
  norm: string;
  /** Combinación de FLAG.*; 0 si no aplica ninguna. */
  flags?: number;
};

export type SearchOptions = {
  conversationId?: string;
  limit: number;
  /**
   * Solo entradas con ALGUNA de estas etiquetas. Con `query` vacío y `flags` se "navega"
   * (todas las entradas de ese tipo, de la más reciente a la más antigua).
   */
  flags?: number;
};

const GRAM = 3;
const COMPACT_MIN_DEAD = 2048;
/** Hasta este límite se usa una lista corta ordenada; por encima, se acumula y ordena una vez. */
const TOP_K_MAX = 64;

function* grams(text: string): Generator<string> {
  for (let i = 0; i + GRAM <= text.length; i++) yield text.slice(i, i + GRAM);
}

/** Intersección de dos listas ordenadas: recorre la corta y busca en la larga por bisección. */
function intersect(small: number[], large: number[]): number[] {
  const out: number[] = [];
  let lo = 0;
  for (const value of small) {
    let hi = large.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (large[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo === large.length) break;
    if (large[lo] === value) out.push(value);
  }
  return out;
}

export class TrigramIndex {
  private entries: (EngineEntry | undefined)[] = [];
  private slotByKey = new Map<string, number>();
  private postings = new Map<string, number[]>();
  private dead = 0;

  /** Entradas vivas. */
  get size(): number {
    return this.slotByKey.size;
  }

  has(key: string): boolean {
    return this.slotByKey.has(key);
  }

  /** Añade o reemplaza una entrada. */
  upsert(entry: EngineEntry): void {
    this.remove(entry.key);
    const slot = this.entries.length;
    this.entries.push(entry);
    this.slotByKey.set(entry.key, slot);
    for (const gram of grams(entry.norm)) {
      const list = this.postings.get(gram);
      if (!list) this.postings.set(gram, [slot]);
      else if (list[list.length - 1] !== slot) list.push(slot); // sin repetir dentro de la entrada
    }
  }

  remove(key: string): boolean {
    const slot = this.slotByKey.get(key);
    if (slot === undefined) return false;
    this.entries[slot] = undefined;
    this.slotByKey.delete(key);
    this.dead++;
    if (this.dead >= COMPACT_MIN_DEAD && this.dead > this.size) this.compact();
    return true;
  }

  removeConversation(conversationId: string): number {
    const keys: string[] = [];
    for (const entry of this.entries) if (entry?.conversationId === conversationId) keys.push(entry.key);
    keys.forEach((key) => this.remove(key));
    return keys.length;
  }

  /** Reconstruye sin lápidas (las listas de trigramas arrastran ids muertos hasta entonces). */
  compact(): void {
    const live = this.entries.filter((entry): entry is EngineEntry => entry !== undefined);
    this.entries = [];
    this.slotByKey = new Map();
    this.postings = new Map();
    this.dead = 0;
    live.forEach((entry) => this.upsert(entry));
  }

  /**
   * Entradas cuyo texto contiene `query` (ya normalizado), de la más reciente a la más
   * antigua. Con 1 sola letra no devuelve nada (demasiado ruido); con `query` vacío solo
   * si se indica `flags` (modo "navegar por tipo").
   */
  search(query: string, options: SearchOptions): EngineEntry[] {
    const { conversationId, limit, flags } = options;
    if (limit <= 0 || query.length === 1) return [];
    if (query.length === 0 && !flags) return [];

    // Pocos resultados: lista corta ordenada (permite saltarse el `includes` de lo que ya no
    // puede entrar). Muchos (navegación de coincidencias): se acumulan y se ordenan una vez.
    const small = limit <= TOP_K_MAX;
    const top: EngineEntry[] = [];
    const all: EngineEntry[] = [];
    const accept = (entry: EngineEntry | undefined) => {
      if (!entry) return;
      if (conversationId !== undefined && entry.conversationId !== conversationId) return;
      if (flags && ((entry.flags ?? 0) & flags) === 0) return;
      if (small) {
        if (top.length === limit && entry.createdAt <= top[limit - 1].createdAt) return;
        if (query && !entry.norm.includes(query)) return;
        let at = top.length;
        while (at > 0 && top[at - 1].createdAt < entry.createdAt) at--;
        top.splice(at, 0, entry);
        if (top.length > limit) top.pop();
      } else {
        if (query && !entry.norm.includes(query)) return;
        all.push(entry);
      }
    };

    if (query.length < GRAM) {
      // Sin trigrama posible (navegar por tipo o 2 letras): recorrido lineal en memoria.
      for (const entry of this.entries) accept(entry);
    } else {
      const lists: number[][] = [];
      for (const gram of new Set(grams(query))) {
        const list = this.postings.get(gram);
        if (!list) return [];
        lists.push(list);
      }
      lists.sort((a, b) => a.length - b.length);
      let candidates = lists[0];
      for (let i = 1; i < lists.length && candidates.length > 0; i++) {
        candidates = intersect(candidates, lists[i]);
      }
      for (const slot of candidates) accept(this.entries[slot]);
    }

    if (small) return top;
    all.sort((a, b) => b.createdAt - a.createdAt);
    return all.length > limit ? all.slice(0, limit) : all;
  }
}
