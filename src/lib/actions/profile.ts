"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseAvatar } from "@/lib/avatar";
import type { ActionResult } from "@/lib/types/chat";

// Cambiar de avatar es barato, pero se limita para que nadie bombardee la base de datos.
const AVATAR_RATE_LIMIT = 30;
const AVATAR_RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Guarda el avatar del usuario ("estilo:semilla"). `null` vuelve al que se deriva del username.
 * Solo se guarda ese texto corto; la imagen se genera siempre en el momento.
 */
export async function updateAvatarAction(avatar: string | null): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { success: false, error: "No autenticado" };

  if (avatar !== null && !parseAvatar(avatar)) {
    return { success: false, error: "Avatar no válido" };
  }

  const rateLimit = await checkRateLimit("update-avatar", AVATAR_RATE_LIMIT, AVATAR_RATE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return { success: false, error: "Demasiados cambios seguidos. Inténtalo en unos minutos." };
  }

  await prisma.user.update({ where: { id: session.userId }, data: { avatar } });
  return { success: true };
}
