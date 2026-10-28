import { test } from "node:test";
import assert from "node:assert/strict";
import { sortConversations } from "@/lib/conversation-order";

const d = (iso: string) => new Date(iso);
const item = (id: string, opts: { pin?: string; last?: string; created?: string }) => ({
  id,
  pinnedAt: opts.pin ? d(opts.pin) : null,
  createdAt: d(opts.created ?? "2026-01-01T00:00:00Z"),
  lastMessage: opts.last ? { createdAt: d(opts.last) } : null,
});

test("orden de la lista de chats", () => {
  const sorted = sortConversations([
    item("viejo", { last: "2026-02-01T00:00:00Z" }),
    item("nuevo", { last: "2026-03-01T00:00:00Z" }),
    item("fijado-antiguo", { pin: "2026-02-01T00:00:00Z", last: "2026-01-02T00:00:00Z" }),
    item("fijado-reciente", { pin: "2026-02-05T00:00:00Z", last: "2026-01-02T00:00:00Z" }),
    item("sin-mensajes-recien-creado", { created: "2026-04-01T00:00:00Z" }),
  ]).map((c) => c.id);
  assert.deepEqual(sorted, [
    "fijado-reciente",
    "fijado-antiguo",
    "sin-mensajes-recien-creado",
    "nuevo",
    "viejo",
  ]);
});

test("no muta la lista original", () => {
  const input = [item("a", { last: "2026-01-01T00:00:00Z" }), item("b", { last: "2026-02-01T00:00:00Z" })];
  sortConversations(input);
  assert.equal(input[0].id, "a");
});
