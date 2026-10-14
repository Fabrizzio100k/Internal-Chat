import "server-only";
import { createHmac } from "crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  INBOX_EVENT_NAME,
  type InboxEvent,
  type RealtimeMessage,
} from "@/lib/types/realtime";

/**
 * Tiempo real PRIVADO: en vez de que el navegador escuche la tabla `messages`
 * completa (lo que exponía todos los mensajes a cualquier usuario), el servidor
 * publica cada evento SOLO en el canal "inbox" de cada participante.
 *
 * El nombre del canal es un HMAC (derivado de SESSION_SECRET) del userId: no se
 * puede calcular ni adivinar sin el secreto, y solo se entrega al propio usuario
 * ya autenticado (lo pasa el layout de /chat). Las tablas quedan cerradas al
 * navegador con RLS (ver scripts/setup-realtime.ts).
 */
export function inboxTopic(userId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET no está definido");
  const digest = createHmac("sha256", secret).update(`inbox:v1:${userId}`).digest("hex");
  return `inbox:${digest.slice(0, 40)}`;
}

/** Convierte un mensaje de Prisma (con sender y attachments) al formato de red. */
export function toRealtimeMessage(m: {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  kind: string | null;
  targetUserIds: string[];
  sender: { id: string; username: string };
  attachments: { id: string; fileName: string; fileType: string; fileSize: number }[];
}): RealtimeMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    kind: m.kind,
    targetUserIds: m.targetUserIds,
    sender: m.sender,
    // Nunca se envía storagePath: la descarga siempre pasa por /api/upload/[id].
    attachments: m.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileType: a.fileType,
      fileSize: a.fileSize,
    })),
  };
}

async function publishToUsers(userIds: string[], event: InboxEvent): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[realtime] Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    return;
  }
  if (userIds.length === 0) return;

  // Una sola petición HTTP con un mensaje por destinatario.
  const messages = userIds.map((userId) => ({
    topic: inboxTopic(userId),
    event: INBOX_EVENT_NAME,
    payload: event,
    private: false,
  }));

  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("[realtime] broadcast falló:", res.status, await res.text());
  } catch (error) {
    console.error("[realtime] broadcast error:", error);
  }
}

/**
 * Publica `event` a todos los participantes ACTUALES de la conversación (más
 * `extraUserIds`, p. ej. alguien que acaba de salir o ser expulsado y por tanto
 * ya no figura). Se ejecuta con after(): la respuesta al usuario no espera.
 */
export function publishToConversation(
  conversationId: string,
  event: InboxEvent,
  extraUserIds: string[] = [],
): void {
  after(async () => {
    try {
      const rows = await prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      const ids = new Set([...rows.map((r) => r.userId), ...extraUserIds]);
      await publishToUsers([...ids], event);
    } catch (error) {
      console.error("[realtime] publishToConversation error:", error);
    }
  });
}

/** Publica un evento a usuarios concretos (sin consultar la conversación). */
export function publishToUsersAfter(userIds: string[], event: InboxEvent): void {
  after(() => publishToUsers(userIds, event));
}
