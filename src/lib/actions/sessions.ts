"use server";

import { prisma } from "@/lib/prisma";
import { forgetSessionValidation, getSession } from "@/lib/auth";
import { publishToUsersAfter } from "@/lib/realtime-server";
import { APP_VERSION } from "@/lib/version";
import type { ActionResult } from "@/lib/types/chat";
import type { DeviceSessionItem } from "@/lib/types/sessions";

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("No autenticado");
  return session;
}

/** Dispositivos con sesión activa (más recientes primero); marca el actual. */
export async function listSessionsAction(): Promise<DeviceSessionItem[]> {
  const session = await requireSession();
  const rows = await prisma.userSession.findMany({
    where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
    select: {
      id: true,
      deviceName: true,
      deviceType: true,
      ip: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    deviceType: row.deviceType === "mobile" || row.deviceType === "tablet" ? row.deviceType : "desktop",
    isCurrent: row.id === session.sessionId,
  }));
}

/** Cierra la sesión de OTRO dispositivo. La del dispositivo actual se cierra con "Cerrar sesión". */
export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (typeof sessionId !== "string" || sessionId === session.sessionId) {
    return { success: false, error: "Usa «Cerrar sesión» para salir de este dispositivo" };
  }
  const result = await prisma.userSession.updateMany({
    where: { id: sessionId, userId: session.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) return { success: false, error: "Esa sesión ya no existe" };
  forgetSessionValidation(sessionId);
  // Aviso inmediato al dispositivo remoto (si está conectado); si no, lo detecta al reconectar o en su chequeo periódico.
  publishToUsersAfter([session.userId], { type: "session_revoked", sessionIds: [sessionId] });
  return { success: true };
}

/** Cierra todas las sesiones salvo la de este dispositivo. */
export async function revokeOtherSessionsAction(): Promise<ActionResult & { count?: number }> {
  const session = await requireSession();
  const others = await prisma.userSession.findMany({
    where: { userId: session.userId, revokedAt: null, id: { not: session.sessionId } },
    select: { id: true },
  });
  if (others.length === 0) return { success: true, count: 0 };
  await prisma.userSession.updateMany({
    where: { id: { in: others.map((o) => o.id) }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  others.forEach((o) => forgetSessionValidation(o.id));
  publishToUsersAfter([session.userId], {
    type: "session_revoked",
    sessionIds: others.map((o) => o.id),
  });
  return { success: true, count: others.length };
}

/**
 * Latido del cliente: dice si esta sesión sigue vigente. Si se revocó desde otro
 * dispositivo, el navegador borra sus claves y vuelve al login (ver SessionGuard).
 * No lanza: devuelve false.
 */
export async function checkSessionAction(): Promise<boolean> {
  try {
    return (await getSession()) !== null;
  } catch {
    return true; // un fallo transitorio de BD no debe cerrar la sesión de nadie
  }
}

/**
 * El usuario cerró el popup de novedades. Solo se acepta la versión que sirve ESTE
 * servidor (nadie puede marcar como vista una versión futura).
 */
export async function acknowledgeVersionAction(version: string): Promise<ActionResult> {
  const session = await requireSession();
  if (version !== APP_VERSION) return { success: true }; // cliente desfasado: se volverá a mostrar
  await prisma.user.update({
    where: { id: session.userId },
    data: { lastSeenVersion: APP_VERSION },
  });
  return { success: true };
}
