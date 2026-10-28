"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { publishToConversation } from "@/lib/realtime-server";
import {
  epochKeyRows,
  findUsersWithoutKeys,
  isKeyEpochUpdate,
  validateEpochKeys,
} from "@/lib/keys-server";
import type {
  KeyActionResult,
  KeyBundle,
  KeyEpochUpdate,
  MyKeysPayload,
  PublicKeyInfo,
  WrappedKeyEntry,
} from "@/lib/types/e2ee";

const MAX_PUBLIC_KEY_LOOKUP = 100;

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("No autenticado");
  return session;
}

/** Mis claves guardadas (la privada llega cifrada con mi contraseña). null = aún sin E2EE. */
export async function getMyKeysAction(): Promise<MyKeysPayload | null> {
  const session = await requireSession();
  const key = await prisma.userKey.findUnique({
    where: { userId: session.userId },
    select: { ecdhPublicKey: true, signPublicKey: true, encryptedPrivateKeys: true },
  });
  return key;
}

/** Claves públicas de varios usuarios (para repartir la clave de un grupo). */
export async function getPublicKeysAction(userIds: string[]): Promise<PublicKeyInfo[]> {
  await requireSession();
  const ids = [...new Set(userIds)].filter((id) => typeof id === "string").slice(0, MAX_PUBLIC_KEY_LOOKUP);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      username: true,
      key: { select: { ecdhPublicKey: true, signPublicKey: true } },
    },
  });
  return users.map((u) => ({
    userId: u.id,
    username: u.username,
    ecdhPublicKey: u.key?.ecdhPublicKey ?? null,
    signPublicKey: u.key?.signPublicKey ?? null,
  }));
}

/**
 * Todo lo necesario para cifrar/descifrar una conversación: época vigente, claves
 * públicas de los miembros y de quienes firmaron, y MIS envolturas de clave.
 */
export async function getKeyBundleAction(conversationId: string): Promise<KeyBundle | null> {
  const session = await requireSession();

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      isGroup: true,
      currentEpoch: true,
      keyRotationPending: true,
      participants: {
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              id: true,
              username: true,
              key: { select: { ecdhPublicKey: true, signPublicKey: true } },
            },
          },
        },
      },
    },
  });
  const me = conversation?.participants.find((p) => p.userId === session.userId);
  if (!conversation || !me) return null;

  const myKeys = await prisma.conversationKey.findMany({
    where: { conversationId, userId: session.userId },
    select: { epoch: true, wrappedKey: true, signature: true, wrappedById: true },
    orderBy: { epoch: "asc" },
  });

  // Quienes firmaron envolturas o enviaron mensajes pueden haber salido del grupo.
  const memberIds = new Set(conversation.participants.map((p) => p.userId));
  const senders = await prisma.message.findMany({
    where: { conversationId, kind: null },
    distinct: ["senderId"],
    select: { senderId: true },
  });
  const extraIds = new Set<string>();
  for (const id of [...senders.map((s) => s.senderId), ...myKeys.map((k) => k.wrappedById)]) {
    if (!memberIds.has(id)) extraIds.add(id);
  }
  const extraUsers = extraIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...extraIds] } },
        select: {
          id: true,
          username: true,
          key: { select: { ecdhPublicKey: true, signPublicKey: true } },
        },
      })
    : [];

  const toInfo = (u: {
    id: string;
    username: string;
    key: { ecdhPublicKey: string; signPublicKey: string } | null;
  }): PublicKeyInfo => ({
    userId: u.id,
    username: u.username,
    ecdhPublicKey: u.key?.ecdhPublicKey ?? null,
    signPublicKey: u.key?.signPublicKey ?? null,
  });

  return {
    conversationId,
    isGroup: conversation.isGroup,
    currentEpoch: conversation.currentEpoch,
    rotationPending: conversation.keyRotationPending,
    isAdmin: me.role === "ADMIN",
    members: conversation.participants.map((p) => toInfo(p.user)),
    signers: extraUsers.map(toInfo),
    myKeys,
  };
}

/**
 * Primera clave de una conversación (época 1). La genera el primer cliente que la
 * abre; si dos lo intentan a la vez, el segundo recibe `stale` y usa la ya creada.
 */
export async function initConversationKeysAction(
  conversationId: string,
  keys: WrappedKeyEntry[],
): Promise<KeyActionResult> {
  const session = await requireSession();

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      currentEpoch: true,
      participants: { select: { userId: true } },
    },
  });
  const participantIds = conversation?.participants.map((p) => p.userId) ?? [];
  if (!conversation || !participantIds.includes(session.userId)) {
    return { success: false, error: "No tienes acceso a esta conversación" };
  }
  if (conversation.currentEpoch !== 0) return { success: false, stale: true };

  const missing = await findUsersWithoutKeys(participantIds);
  if (missing.length > 0) {
    return {
      success: false,
      error: `${missing.join(", ")} aún no activó el cifrado (debe iniciar sesión una vez).`,
      missingKeys: missing,
    };
  }

  const valid = await validateEpochKeys(participantIds, keys);
  if (!valid.ok) return { success: false, error: valid.error };

  const update: KeyEpochUpdate = { epoch: 1, keys };
  const applied = await prisma.$transaction(async (tx) => {
    const cas = await tx.conversation.updateMany({
      where: { id: conversationId, currentEpoch: 0 },
      data: { currentEpoch: 1, keyRotationPending: false },
    });
    if (cas.count === 0) return false;
    await tx.conversationKey.createMany({
      data: epochKeyRows(conversationId, update, session.userId),
    });
    return true;
  });
  if (!applied) return { success: false, stale: true };

  publishToConversation(conversationId, { type: "keys_updated", conversationId });
  return { success: true };
}

/**
 * Rotación pendiente (alguien salió del grupo): cualquier miembro actual reparte una
 * clave nueva. Las altas y bajas hechas por un admin rotan dentro de su propia acción.
 */
export async function rotateConversationKeysAction(
  conversationId: string,
  update: KeyEpochUpdate,
): Promise<KeyActionResult> {
  const session = await requireSession();
  if (!isKeyEpochUpdate(update)) return { success: false, error: "Datos inválidos" };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      currentEpoch: true,
      keyRotationPending: true,
      participants: { select: { userId: true } },
    },
  });
  const participantIds = conversation?.participants.map((p) => p.userId) ?? [];
  if (!conversation || !participantIds.includes(session.userId)) {
    return { success: false, error: "No tienes acceso a esta conversación" };
  }
  if (!conversation.keyRotationPending || update.epoch !== conversation.currentEpoch + 1) {
    return { success: false, stale: true };
  }

  const missing = await findUsersWithoutKeys(participantIds);
  if (missing.length > 0) {
    return { success: false, error: "Hay miembros sin cifrado activo", missingKeys: missing };
  }
  const valid = await validateEpochKeys(participantIds, update.keys);
  if (!valid.ok) return { success: false, error: valid.error };

  const applied = await prisma.$transaction(async (tx) => {
    const cas = await tx.conversation.updateMany({
      where: {
        id: conversationId,
        currentEpoch: conversation.currentEpoch,
        keyRotationPending: true,
      },
      data: { currentEpoch: update.epoch, keyRotationPending: false },
    });
    if (cas.count === 0) return false;
    await tx.conversationKey.createMany({
      data: epochKeyRows(conversationId, update, session.userId),
    });
    return true;
  });
  if (!applied) return { success: false, stale: true };

  publishToConversation(conversationId, { type: "keys_updated", conversationId });
  return { success: true };
}
