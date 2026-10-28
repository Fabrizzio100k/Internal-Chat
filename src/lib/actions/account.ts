"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteSession, forgetSessionValidation, getSession } from "@/lib/auth";
import { DELETE_ACCOUNT_PHRASE } from "@/lib/account-constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { MESSAGE_INCLUDE } from "@/lib/messages-server";
import {
  publishToConversation,
  publishToUsersAfter,
  toRealtimeMessage,
} from "@/lib/realtime-server";
import { deleteStoredObjects } from "@/lib/storage";
import { authSecretSchema } from "@/lib/validations/auth";
import type { ActionResult } from "@/lib/types/chat";

const requestSchema = z.object({
  confirmation: z.string().max(100),
  authSecret: authSecretSchema,
});

// Acción destructiva: pocos intentos (también frena adivinar la contraseña desde una sesión robada).
const DELETE_RATE_LIMIT = 5;
const DELETE_RATE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Elimina la cuenta y TODOS sus datos, sin vuelta atrás. Exige (1) la frase de
 * confirmación escrita y (2) la contraseña (el navegador manda `authSecret`, igual que en
 * el login): una sesión robada o una pestaña abandonada no bastan para borrar la cuenta.
 *
 * Qué se borra:
 *  - Mensajes y archivos que envió (en grupos y chats) y los archivos de S3.
 *  - Los chats 1:1 y el de "Mensajes guardados" COMPLETOS, también para la otra persona
 *    (sin ti, esa conversación no tiene sentido y el servidor no puede "anonimizarla").
 *  - Grupos donde era el único miembro. En los demás sale del grupo (la clave se renueva).
 *  - Solicitudes de contacto, claves de cifrado, dispositivos/sesiones y su fila de usuario.
 *
 * Excepción mínima: si firmó claves de grupos donde siguen otras personas, se conserva una
 * fila anónima (`deleted-<id>`, sin contraseña ni claves privadas ni datos personales) con
 * su CLAVE PÚBLICA, porque sin ella los demás miembros dejarían de poder verificar y leer
 * el historial anterior de esos grupos. No contiene nada que identifique a la persona.
 */
export async function deleteAccountAction(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { success: false, error: "No autenticado" };

  const limited = await checkRateLimit("delete-account", DELETE_RATE_LIMIT, DELETE_RATE_WINDOW_MS);
  if (!limited.allowed) {
    return {
      success: false,
      error: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(limited.retryAfterSeconds / 60)} minuto(s).`,
    };
  }

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Datos inválidos" };
  if (parsed.data.confirmation.trim() !== DELETE_ACCOUNT_PHRASE) {
    return { success: false, error: `Escribe exactamente «${DELETE_ACCOUNT_PHRASE}» para confirmar.` };
  }

  const userId = session.userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, username: true },
  });
  if (!user || !(await bcrypt.compare(parsed.data.authSecret, user.passwordHash))) {
    return { success: false, error: "Contraseña incorrecta" };
  }

  // 1) Qué conversaciones desaparecen y de cuáles solo salgo.
  const memberships = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: {
      conversationId: true,
      role: true,
      conversation: {
        select: {
          isGroup: true,
          currentEpoch: true,
          participants: { orderBy: { joinedAt: "asc" }, select: { userId: true, role: true } },
        },
      },
    },
  });

  const doomed: { id: string; notify: string[] }[] = [];
  const leaving: {
    id: string;
    others: { userId: string; role: "ADMIN" | "MEMBER" }[];
    rotate: boolean;
    needsAdmin: boolean;
  }[] = [];
  for (const m of memberships) {
    const others = m.conversation.participants.filter((p) => p.userId !== userId);
    if (!m.conversation.isGroup || others.length === 0) {
      doomed.push({ id: m.conversationId, notify: others.map((p) => p.userId) });
    } else {
      leaving.push({
        id: m.conversationId,
        others,
        rotate: m.conversation.currentEpoch > 0,
        needsAdmin: m.role === "ADMIN" && !others.some((p) => p.role === "ADMIN"),
      });
    }
  }
  const doomedIds = doomed.map((d) => d.id);

  // 2) Archivos de S3 que quedarán huérfanos (se borran después de confirmar la transacción).
  const files = await prisma.attachment.findMany({
    where: {
      OR: [
        { uploaderId: userId },
        { message: { senderId: userId } },
        { message: { conversationId: { in: doomedIds } } },
      ],
    },
    select: { storagePath: true },
  });

  // 3) Todo en una transacción: o se borra completo o no se borra nada.
  const leftMessages = await prisma.$transaction(
    async (tx) => {
      await tx.message.deleteMany({
        where: { OR: [{ senderId: userId }, { conversationId: { in: doomedIds } }] },
      }); // los adjuntos caen en cascada
      await tx.attachment.deleteMany({ where: { uploaderId: userId } });
      await tx.conversation.deleteMany({ where: { id: { in: doomedIds } } });

      const notices = [];
      for (const group of leaving) {
        await tx.conversationParticipant.delete({
          where: { conversationId_userId: { conversationId: group.id, userId } },
        });
        await tx.conversationKey.deleteMany({ where: { conversationId: group.id, userId } });
        if (group.rotate) {
          await tx.conversation.update({
            where: { id: group.id },
            data: { keyRotationPending: true },
          });
        }
        if (group.needsAdmin) {
          await tx.conversationParticipant.update({
            where: {
              conversationId_userId: { conversationId: group.id, userId: group.others[0].userId },
            },
            data: { role: "ADMIN" },
          });
        }
        // Aviso de sistema. Su autor técnico es el miembro más antiguo que queda: la persona
        // que se va ya no puede figurar como remitente (sus mensajes se borran).
        notices.push(
          await tx.message.create({
            data: {
              conversationId: group.id,
              senderId: group.others[0].userId,
              content: `${user.username} eliminó su cuenta`,
              kind: "member_left",
              targetUserIds: [userId],
            },
            include: MESSAGE_INCLUDE,
          }),
        );
      }

      await tx.chatRequest.deleteMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } });
      await tx.conversationParticipant.deleteMany({ where: { userId } });
      await tx.conversationKey.deleteMany({ where: { userId } });
      await tx.userSession.deleteMany({ where: { userId } });

      const signedKeys = await tx.conversationKey.count({ where: { wrappedById: userId } });
      if (signedKeys > 0) {
        // Lápida anónima (ver la explicación arriba).
        await tx.user.update({
          where: { id: userId },
          data: { username: `deleted-${userId}`, passwordHash: "!", lastSeenVersion: null },
        });
        await tx.userKey.update({ where: { userId }, data: { encryptedPrivateKeys: "deleted" } });
      } else {
        await tx.user.delete({ where: { id: userId } }); // clave y demás caen en cascada
      }
      return notices;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // 4) Después de confirmar: sesión, archivos y avisos en vivo.
  forgetSessionValidation(session.sessionId);
  await deleteSession();

  const storagePaths = files.map((f) => f.storagePath);
  if (storagePaths.length > 0) after(() => deleteStoredObjects(storagePaths).then(() => undefined));

  for (const message of leftMessages) {
    publishToConversation(message.conversationId, {
      type: "message",
      message: toRealtimeMessage(message),
    });
  }
  for (const conversation of doomed) {
    if (conversation.notify.length > 0) {
      publishToUsersAfter(conversation.notify, {
        type: "conversation_removed",
        conversationId: conversation.id,
      });
    }
  }
  return { success: true };
}
