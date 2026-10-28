import "server-only";
import { prisma } from "@/lib/prisma";
import type { WrappedKeyEntry, KeyEpochUpdate } from "@/lib/types/e2ee";

// Módulo de servidor SIN "use server" (igual que messages-server): no valida sesión,
// solo lo usan acciones que ya validaron al usuario.
//
// El servidor NO puede comprobar que las envolturas contengan una clave válida
// (están cifradas para cada miembro); solo garantiza la forma y que cada miembro
// actual (y nadie más) reciba una. La autenticidad la verifican los clientes con
// la firma del que repartió la clave.

const MAX_WRAPPED_LENGTH = 600;
const MAX_SIGNATURE_LENGTH = 200;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type EpochValidation =
  | { ok: true }
  | { ok: false; error: string; missingKeys?: string[] };

/**
 * Comprueba que `keys` contenga exactamente una envoltura por cada id de
 * `participantIds`, que todos tengan claves públicas activadas y que los textos
 * tengan forma de base64 con tamaño razonable.
 */
export async function validateEpochKeys(
  participantIds: string[],
  keys: WrappedKeyEntry[],
): Promise<EpochValidation> {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { ok: false, error: "Faltan las claves de la conversación" };
  }

  const expected = new Set(participantIds);
  const seen = new Set<string>();
  for (const entry of keys) {
    if (
      !entry ||
      typeof entry.userId !== "string" ||
      typeof entry.wrappedKey !== "string" ||
      typeof entry.signature !== "string" ||
      !BASE64.test(entry.wrappedKey) ||
      !BASE64.test(entry.signature) ||
      entry.wrappedKey.length > MAX_WRAPPED_LENGTH ||
      entry.signature.length > MAX_SIGNATURE_LENGTH
    ) {
      return { ok: false, error: "Claves de conversación inválidas" };
    }
    if (!expected.has(entry.userId) || seen.has(entry.userId)) {
      return { ok: false, error: "Los destinatarios de las claves no coinciden con los miembros" };
    }
    seen.add(entry.userId);
  }
  if (seen.size !== expected.size) {
    return { ok: false, error: "Faltan claves para algún miembro" };
  }
  return { ok: true };
}

/** Miembros (de `userIds`) que todavía no activaron el cifrado, con su username. */
export async function findUsersWithoutKeys(userIds: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, key: null },
    select: { username: true },
    orderBy: { username: "asc" },
  });
  return users.map((u) => u.username);
}

/** Filas de ConversationKey para una época nueva, repartidas por `wrapperId`. */
export function epochKeyRows(
  conversationId: string,
  update: KeyEpochUpdate,
  wrapperId: string,
) {
  return update.keys.map((k) => ({
    conversationId,
    epoch: update.epoch,
    userId: k.userId,
    wrappedKey: k.wrappedKey,
    signature: k.signature,
    wrappedById: wrapperId,
  }));
}

/** Forma mínima de un KeyEpochUpdate recibido del cliente (no confiable). */
export function isKeyEpochUpdate(value: unknown): value is KeyEpochUpdate {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.epoch === "number" && Number.isInteger(v.epoch) && v.epoch >= 1 && Array.isArray(v.keys);
}
