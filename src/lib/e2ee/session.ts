"use client";

import type { StoredIdentity } from "@/lib/e2ee/key-store";

/**
 * Identidad desbloqueada de esta pestaña (claves privadas NO extraíbles). La fija el
 * E2eeProvider al desbloquear; el resto de módulos de cliente la leen de aquí.
 */
export type ActiveIdentity = StoredIdentity & { username: string };

let active: ActiveIdentity | null = null;
const resetListeners = new Set<() => void>();

export function setActiveIdentity(identity: ActiveIdentity | null): void {
  active = identity;
  if (!identity) resetListeners.forEach((listener) => listener());
}

export function getActiveIdentity(): ActiveIdentity | null {
  return active;
}

export function requireIdentity(): ActiveIdentity {
  if (!active) throw new Error("El cifrado no está desbloqueado");
  return active;
}

/** Los módulos con cachés por usuario se registran aquí para vaciarlas al cerrar sesión. */
export function onIdentityReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}
