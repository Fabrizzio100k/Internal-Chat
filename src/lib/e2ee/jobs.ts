"use client";

import { onIdentityReset } from "@/lib/e2ee/session";
import { runLegacyMigration } from "@/lib/e2ee/migrate-legacy";
import { runSearchIndexer } from "@/lib/e2ee/search-index";

/**
 * Tareas en segundo plano tras desbloquear: completar el índice de búsqueda local y
 * migrar al E2EE mis mensajes antiguos. Idempotente; se detiene al cerrar sesión.
 */

let controller: AbortController | null = null;
let startedFor: string | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function stopBackgroundJobs(): void {
  controller?.abort();
  controller = null;
  startedFor = null;
}

onIdentityReset(stopBackgroundJobs);

export function startBackgroundJobs(userId: string): void {
  if (startedFor === userId) return;
  stopBackgroundJobs();
  startedFor = userId;
  controller = new AbortController();
  const { signal } = controller;

  void (async () => {
    // Deja pasar primero la carga de la pantalla (menos peticiones simultáneas).
    await sleep(2500);
    if (signal.aborted) return;
    try {
      await runSearchIndexer(userId, signal);
      if (signal.aborted) return;
      await runLegacyMigration(signal);
    } catch (error) {
      console.error("[e2ee] tareas en segundo plano:", error);
    }
  })();
}
