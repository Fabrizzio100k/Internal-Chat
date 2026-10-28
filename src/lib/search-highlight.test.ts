import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatchRanges } from "@/lib/search-highlight";
import { normalize } from "@/lib/e2ee/search-engine";

const find = (text: string, query: string) =>
  findMatchRanges(text, normalize(query)).map(([s, e]) => text.slice(s, e));

test("ignora mayúsculas y acentos pero devuelve el texto original", () => {
  assert.deepEqual(find("Llegó el Camión y luego CAMIONES", "camion"), ["Camión", "CAMION"]);
  assert.deepEqual(find("mañana ñandú", "nandu"), ["ñandú"]);
});

test("las posiciones corresponden al texto original aunque haya acentos antes", () => {
  const text = "áéíóú coincide aquí";
  const [range] = findMatchRanges(text, "coincide");
  assert.equal(text.slice(range[0], range[1]), "coincide");
});

test("no se solapan y una consulta vacía no coincide", () => {
  assert.equal(findMatchRanges("aaaa", "aa").length, 2);
  assert.deepEqual(findMatchRanges("hola", ""), []);
});

test("maneja emojis (pares sustitutos) sin cortarlos", () => {
  const text = "hola 👋 mundo";
  const [range] = findMatchRanges(text, "mundo");
  assert.equal(text.slice(range[0], range[1]), "mundo");
  assert.deepEqual(findMatchRanges(text, "👋").map(([s, e]) => text.slice(s, e)), ["👋"]);
});
