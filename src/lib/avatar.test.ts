import { test } from "node:test";
import assert from "node:assert/strict";
import { AVATAR_STYLES, parseAvatar, randomAvatarSeed, resolveAvatar, serializeAvatar } from "@/lib/avatar";
import { avatarDataUri } from "@/lib/avatar-svg";

test("parseAvatar acepta solo estilo conocido + semilla alfanumérica corta", () => {
  assert.deepEqual(parseAvatar("animals:k3x9a"), { style: "animals", seed: "k3x9a" });
  assert.equal(parseAvatar(null), null);
  assert.equal(parseAvatar(""), null);
  assert.equal(parseAvatar("desconocido:abc"), null);
  assert.equal(parseAvatar("animals:"), null);
  assert.equal(parseAvatar("animals:ABC"), null);
  assert.equal(parseAvatar("animals:a b"), null);
  assert.equal(parseAvatar("animals:<script>"), null);
  assert.equal(parseAvatar(`animals:${"a".repeat(25)}`), null);
});

test("resolveAvatar: sin elección es estable por username; con elección la respeta", () => {
  assert.deepEqual(resolveAvatar("fabrizzio", null), resolveAvatar("fabrizzio", null));
  assert.equal(resolveAvatar("fabrizzio", null).seed, "fabrizzio");
  assert.deepEqual(resolveAvatar("fabrizzio", "robots:abc"), { style: "robots", seed: "abc" });
  // Un valor corrupto en la base cae al avatar por defecto en vez de romper la pantalla.
  assert.equal(resolveAvatar("fabrizzio", "basura").seed, "fabrizzio");
});

test("el estilo por defecto reparte entre varios estilos, con animales como el más común", () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 500; i++) {
    const style = resolveAvatar(`usuario${i}`, null).style;
    counts.set(style, (counts.get(style) ?? 0) + 1);
  }
  assert.equal(counts.size, AVATAR_STYLES.length);
  const animals = counts.get("animals") ?? 0;
  for (const [style, n] of counts) if (style !== "animals") assert.ok(animals > n);
});

test("randomAvatarSeed siempre es válida para guardar", () => {
  for (let i = 0; i < 200; i++) {
    const spec = { style: "animals" as const, seed: randomAvatarSeed() };
    assert.deepEqual(parseAvatar(serializeAvatar(spec)), spec);
  }
});

test("avatarDataUri genera un SVG determinista para cada estilo", () => {
  for (const { id } of AVATAR_STYLES) {
    const a = avatarDataUri({ style: id, seed: "prueba" });
    assert.match(a, /^data:image\/svg\+xml/);
    assert.equal(a, avatarDataUri({ style: id, seed: "prueba" }));
    assert.notEqual(a, avatarDataUri({ style: id, seed: "otra" }));
  }
});
