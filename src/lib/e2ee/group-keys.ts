"use client";

import { addGroupMembersAction, removeGroupMemberAction } from "@/lib/actions/groups";
import { buildGroupKeyUpdate } from "@/lib/e2ee/conversation-keys";
import { describeE2eeError } from "@/lib/e2ee/messages";
import type { KeyActionResult, KeyEpochUpdate } from "@/lib/types/e2ee";

/**
 * Altas y bajas de un grupo con renovación de clave. El servidor no puede repartir
 * claves (no las conoce), así que el admin que hace el cambio genera la clave nueva
 * en su navegador y la cifra para cada miembro resultante. Quien entra no puede leer
 * lo anterior; quien sale no puede leer lo que se escriba desde ese momento.
 */

const MAX_ATTEMPTS = 3;

async function withNewEpoch(
  conversationId: string,
  change: { add?: string[]; remove?: string },
  call: (update: KeyEpochUpdate) => Promise<KeyActionResult>,
): Promise<KeyActionResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let update: KeyEpochUpdate;
    try {
      update = await buildGroupKeyUpdate(conversationId, change);
    } catch (error) {
      return { success: false, error: describeE2eeError(error) };
    }
    const result = await call(update);
    // `stale`: otra persona cambió la clave a la vez; se recalcula con el estado nuevo.
    if (!result.stale) return result;
  }
  return { success: false, error: "La clave del grupo cambió varias veces. Intenta de nuevo." };
}

export function addMembersEncrypted(conversationId: string, userIds: string[]) {
  return withNewEpoch(conversationId, { add: userIds }, (update) =>
    addGroupMembersAction(conversationId, userIds, update),
  );
}

export function removeMemberEncrypted(conversationId: string, userId: string) {
  return withNewEpoch(conversationId, { remove: userId }, (update) =>
    removeGroupMemberAction(conversationId, userId, update),
  );
}
