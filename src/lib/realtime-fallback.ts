/**
 * Respaldo para redes que bloquean WebSockets (VPN, proxies corporativos): si el tiempo real no
 * está conectado durante `graceMs` seguidos (tiempo en el que la librería reintenta sola), se
 * pregunta al servidor cada `pollMs` por lo más reciente. En cuanto el tiempo real vuelve, el
 * sondeo se detiene. Lógica pura (sin React ni Supabase) para poder probarla.
 */

/** Espera con reintentos del WebSocket antes de pasar a sondear. */
export const FALLBACK_GRACE_MS = 30_000;
/** Cada cuánto se pide lo último mientras dure el respaldo. */
export const FALLBACK_POLL_MS = 5_000;

export type RealtimeFallback = {
  /** Informa el estado del tiempo real: true = conectado, false = caído o conectando. */
  setConnected: (connected: boolean) => void;
  /** ¿Está sondeando ahora mismo? */
  isPolling: () => boolean;
  /** Sondeo inmediato (p. ej. al volver a la pestaña); no hace nada si no está en modo respaldo. */
  pollNow: () => void;
  dispose: () => void;
};

export function createRealtimeFallback({
  onPoll,
  graceMs = FALLBACK_GRACE_MS,
  pollMs = FALLBACK_POLL_MS,
  isVisible = () => true,
}: {
  onPoll: () => void;
  graceMs?: number;
  pollMs?: number;
  /** Con la pestaña oculta no se sondea (ahorra peticiones y batería). */
  isVisible?: () => boolean;
}): RealtimeFallback {
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  const poll = () => {
    if (isVisible()) onPoll();
  };

  const stop = () => {
    if (graceTimer) clearTimeout(graceTimer);
    if (pollTimer) clearInterval(pollTimer);
    graceTimer = null;
    pollTimer = null;
  };

  return {
    setConnected(connected) {
      if (disposed) return;
      if (connected) {
        stop();
        return;
      }
      // Ya contando la espera o ya sondeando: el corte sigue siendo el mismo.
      if (graceTimer || pollTimer) return;
      graceTimer = setTimeout(() => {
        graceTimer = null;
        poll();
        pollTimer = setInterval(poll, pollMs);
      }, graceMs);
    },
    isPolling: () => pollTimer !== null,
    pollNow() {
      if (pollTimer) poll();
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
