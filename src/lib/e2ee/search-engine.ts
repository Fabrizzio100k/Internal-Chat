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

export type EngineEntry = {
  /** Clave única (id del mensaje, o `${mensaje}#${archivo}` para archivos). */
  key: string;
  conversationId: string;
  /** Milisegundos desde epoch: se ordena por el más reciente. */
  createdAt: number;
  /** Texto ya normalizado. */
  norm: string;
};

const GRAM = 3;
const COMPACT_MIN_DEAD = 2048;

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
   * antigua. `conversationId` limita a un chat. Con menos de 2 letras no devuelve nada.
   */
  search(query: string, options: { conversationId?: string; limit: number }): EngineEntry[] {
    if (query.length < 2 || options.limit <= 0) return [];
    const { conversationId, limit } = options;
    // Solo se conservan los `limit` más recientes (inserción en una lista corta ordenada):
    // evita acumular y ordenar cientos de miles de coincidencias, y permite saltarse el
    // `includes` de todo lo que ya no puede entrar entre los mejores.
    const top: EngineEntry[] = [];
    const accept = (entry: EngineEntry | undefined) => {
      if (!entry) return;
      if (conversationId !== undefined && entry.conversationId !== conversationId) return;
      if (top.length === limit && entry.createdAt <= top[limit - 1].createdAt) return;
      if (!entry.norm.includes(query)) return;
      let at = top.length;
      while (at > 0 && top[at - 1].createdAt < entry.createdAt) at--;
      top.splice(at, 0, entry);
      if (top.length > limit) top.pop();
    };

    if (query.length < GRAM) {
      // Sin trigrama posible: recorrido lineal en memoria (rápido incluso con cientos de miles).
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

    return top;
  }
}
