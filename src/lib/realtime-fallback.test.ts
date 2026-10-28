import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createRealtimeFallback } from "@/lib/realtime-fallback";

function setup(isVisible = () => true) {
  let polls = 0;
  const fallback = createRealtimeFallback({ onPoll: () => polls++, isVisible });
  return { fallback, polls: () => polls };
}

test("no sondea durante los 30 s de gracia; después sondea cada 5 s", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const { fallback, polls } = setup();
    fallback.setConnected(false);

    mock.timers.tick(29_999);
    assert.equal(polls(), 0);
    assert.equal(fallback.isPolling(), false);

    mock.timers.tick(1); // 30 s: primer sondeo inmediato
    assert.equal(polls(), 1);
    assert.equal(fallback.isPolling(), true);

    mock.timers.tick(5_000);
    assert.equal(polls(), 2);
    mock.timers.tick(10_000);
    assert.equal(polls(), 4);
    fallback.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("si el tiempo real vuelve antes de 30 s, nunca sondea", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const { fallback, polls } = setup();
    fallback.setConnected(false);
    mock.timers.tick(20_000);
    fallback.setConnected(true);
    mock.timers.tick(120_000);
    assert.equal(polls(), 0);
    assert.equal(fallback.isPolling(), false);
    fallback.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("al reconectar se detiene el sondeo y un nuevo corte vuelve a esperar 30 s", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const { fallback, polls } = setup();
    fallback.setConnected(false);
    mock.timers.tick(35_000);
    assert.equal(polls(), 1);

    fallback.setConnected(true);
    assert.equal(fallback.isPolling(), false);
    mock.timers.tick(60_000);
    assert.equal(polls(), 1);

    fallback.setConnected(false);
    mock.timers.tick(29_999);
    assert.equal(polls(), 1);
    mock.timers.tick(1);
    assert.equal(polls(), 2);
    fallback.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("avisos repetidos de desconexión no reinician la espera", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const { fallback, polls } = setup();
    fallback.setConnected(false);
    mock.timers.tick(20_000);
    fallback.setConnected(false); // el canal reintenta y vuelve a fallar
    mock.timers.tick(10_000);
    assert.equal(polls(), 1);
    fallback.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("con la pestaña oculta no sondea; pollNow solo actúa en modo respaldo", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    let visible = false;
    const { fallback, polls } = setup(() => visible);
    fallback.pollNow(); // aún no hay respaldo activo
    fallback.setConnected(false);
    mock.timers.tick(40_000);
    assert.equal(polls(), 0);

    visible = true;
    fallback.pollNow();
    assert.equal(polls(), 1);
    fallback.dispose();
    mock.timers.tick(60_000);
    assert.equal(polls(), 1);
  } finally {
    mock.timers.reset();
  }
});
