import { test } from "node:test";
import assert from "node:assert/strict";
import { TrigramIndex, normalize, type EngineEntry } from "@/lib/e2ee/search-engine";

const WORDS = [
  "camión", "camiones", "reunión", "mañana", "factura", "pago", "servidor", "deploy", "error",
  "producción", "cliente", "contraseña", "ñandú", "hola", "buenos", "días", "archivo", "informe",
  "aaaa", "abab", "zzz", "ok", "sí", "no",
];

// Generador pseudoaleatorio determinista (las pruebas no deben ser intermitentes).
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function corpus(n: number, seed = 7): EngineEntry[] {
  const rand = rng(seed);
  const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
  return Array.from({ length: n }, (_, i) => ({
    key: `m${i}`,
    conversationId: `c${i % 5}`,
    createdAt: 1_700_000_000_000 + Math.floor(rand() * 1e9),
    norm: normalize(Array.from({ length: 1 + Math.floor(rand() * 8) }, pick).join(" ")),
  }));
}

/** Oráculo de fuerza bruta: la definición de "buscar" que el motor debe respetar. */
function brute(entries: EngineEntry[], q: string, conversationId: string | undefined, limit: number) {
  return entries
    .filter((e) => (conversationId === undefined || e.conversationId === conversationId) && e.norm.includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((e) => e.key);
}

const QUERIES = ["ca", "cam", "camion", "ones", "ñand", "nandu", "aaa", "aaaa", "aaaaa", "ab", "abab", "ba b", "xyz", "z", "p", " "];

test("coincide con la búsqueda por fuerza bruta (con y sin filtro de conversación)", () => {
  const entries = corpus(1500);
  const index = new TrigramIndex();
  entries.forEach((e) => index.upsert(e));
  assert.equal(index.size, 1500);
  for (const q of QUERIES) {
    for (const conv of [undefined, "c2"]) {
      const got = index.search(q, { conversationId: conv, limit: 30 }).map((e) => e.key);
      const want = q.length < 2 ? [] : brute(entries, q, conv, 30);
      assert.deepEqual(got, want, `consulta «${q}» conv=${conv}`);
    }
  }
});

test("upsert reemplaza y remove elimina; no quedan resultados fantasma", () => {
  const index = new TrigramIndex();
  index.upsert({ key: "a", conversationId: "c", createdAt: 1, norm: "hola mundo" });
  index.upsert({ key: "b", conversationId: "c", createdAt: 2, norm: "hola luna" });
  assert.deepEqual(index.search("hola", { limit: 10 }).map((e) => e.key), ["b", "a"]);

  index.upsert({ key: "a", conversationId: "c", createdAt: 1, norm: "adios mundo" });
  assert.deepEqual(index.search("hola", { limit: 10 }).map((e) => e.key), ["b"]);
  assert.deepEqual(index.search("adios", { limit: 10 }).map((e) => e.key), ["a"]);

  assert.equal(index.remove("b"), true);
  assert.equal(index.remove("b"), false);
  assert.deepEqual(index.search("hola", { limit: 10 }), []);
  assert.equal(index.size, 1);
});

test("la compactación no cambia los resultados", () => {
  const entries = corpus(3000, 11);
  const index = new TrigramIndex();
  entries.forEach((e) => index.upsert(e));
  const keep = new Map(entries.map((e) => [e.key, e]));
  // Borra dos de cada tres: dispara la compactación automática (muertos > vivos).
  entries.forEach((e, i) => {
    if (i % 3 !== 0) {
      index.remove(e.key);
      keep.delete(e.key);
    }
  });
  const remaining = [...keep.values()];
  assert.equal(index.size, remaining.length);
  for (const q of ["cam", "camion", "ñand", "aaa", "ca"]) {
    assert.deepEqual(
      index.search(q, { limit: 50 }).map((e) => e.key),
      brute(remaining, q, undefined, 50),
      q,
    );
  }
});

test("removeConversation borra solo ese chat", () => {
  const entries = corpus(200, 3);
  const index = new TrigramIndex();
  entries.forEach((e) => index.upsert(e));
  const removed = index.removeConversation("c1");
  assert.equal(removed, entries.filter((e) => e.conversationId === "c1").length);
  assert.ok(index.search("ca", { limit: 500 }).every((e) => e.conversationId !== "c1"));
});

test("respeta el límite y ordena por fecha descendente", () => {
  const index = new TrigramIndex();
  for (let i = 0; i < 100; i++) {
    index.upsert({ key: `k${i}`, conversationId: "c", createdAt: i, norm: "mensaje de prueba" });
  }
  const hits = index.search("prueba", { limit: 5 });
  assert.deepEqual(hits.map((e) => e.createdAt), [99, 98, 97, 96, 95]);
});

test("normalize quita acentos y mayúsculas", () => {
  assert.equal(normalize("CAMIÓN Ñandú"), "camion nandu");
});
