import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyUploadedObject, MAX_ENCRYPTED_FILE_BYTES, isValidAttachmentRef } from "@/lib/storage";
import { publishToConversation } from "@/lib/realtime-server";
import {
  MESSAGE_INCLUDE,
  toWireMessage,
  validateEncryptedPayload,
} from "@/lib/messages-server";

/**
 * Segundo paso de la subida de adjuntos (E2EE): el navegador ya subió cada archivo
 * CIFRADO directo a S3 usando las URLs de /api/upload/presign. Aquí se verifica con
 * S3 (HeadObject) que cada objeto existe con el tamaño declarado —el servidor nunca
 * vio los archivos— y se crea UN mensaje con todos sus adjuntos.
 *
 * El texto, los nombres, tipos y claves de los archivos viajan dentro de `ciphertext`
 * (cifrado en el navegador); el servidor solo conoce el `ref` y el tamaño cifrado.
 *
 * Payload: { conversationId, ciphertext, keyEpoch, attachments: [{ ref, encSize }] }
 */

type IncomingAttachment = { ref: string; encSize: number };

const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const conversationId = body?.conversationId;

  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId requerido" }, { status: 400 });
  }

  const rawAttachments: unknown[] = Array.isArray(body?.attachments) ? body.attachments : [];
  if (rawAttachments.length === 0) {
    return NextResponse.json({ error: "Se requiere al menos un adjunto" }, { status: 400 });
  }
  if (rawAttachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json(
      { error: `Máximo ${MAX_ATTACHMENTS_PER_MESSAGE} adjuntos por mensaje` },
      { status: 400 },
    );
  }

  const attachments: IncomingAttachment[] = [];
  const seenRefs = new Set<string>();
  for (const item of rawAttachments) {
    const a = (item ?? {}) as Record<string, unknown>;
    if (!isValidAttachmentRef(a.ref) || seenRefs.has(a.ref)) {
      return NextResponse.json({ error: "ref inválido" }, { status: 400 });
    }
    if (typeof a.encSize !== "number" || !Number.isInteger(a.encSize) || a.encSize <= 0) {
      return NextResponse.json({ error: "encSize inválido" }, { status: 400 });
    }
    if (a.encSize > MAX_ENCRYPTED_FILE_BYTES) {
      return NextResponse.json({ error: "El archivo supera el límite de 20MB" }, { status: 413 });
    }
    seenRefs.add(a.ref);
    attachments.push({ ref: a.ref, encSize: a.encSize });
  }

  // Repite la validación de pertenencia: no confiar en que el paso de
  // presign siga siendo válido (la sesión pudo cambiar entre ambos pasos).
  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a esta conversación" }, { status: 403 });
  }

  const check = await validateEncryptedPayload(conversationId, body?.ciphertext, body?.keyEpoch);
  if (!check.ok) {
    const status = check.code ? 409 : 400;
    return NextResponse.json({ error: check.error, code: check.code }, { status });
  }

  // Verifica en S3 que todos los objetos existan con el tamaño declarado
  // antes de crear nada en la base de datos.
  const verifications = await Promise.all(
    attachments.map((a) => verifyUploadedObject(`${conversationId}/${a.ref}`, a.encSize)),
  );
  if (verifications.some((ok) => !ok)) {
    return NextResponse.json(
      { error: "Alguno de los archivos no se subió correctamente. Intenta de nuevo." },
      { status: 409 },
    );
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: session.userId,
      ciphertext: body.ciphertext,
      keyEpoch: body.keyEpoch,
      attachments: {
        create: attachments.map((a) => ({
          uploaderId: session.userId,
          storagePath: `${conversationId}/${a.ref}`,
          ref: a.ref,
          encSize: a.encSize,
        })),
      },
    },
    include: MESSAGE_INCLUDE,
  });

  const wire = toWireMessage(message);
  publishToConversation(conversationId, { type: "message", message: wire });

  return NextResponse.json({ success: true, message: wire });
}
