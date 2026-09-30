import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyUploadedObject, MAX_FILE_SIZE_BYTES } from "@/lib/storage";

/**
 * Segundo paso de la subida de adjuntos: el navegador ya subió cada archivo
 * directo a S3 usando las URLs firmadas de /api/upload/presign. Aquí se
 * verifica con S3 (HeadObject) que cada objeto realmente existe y que su
 * tamaño coincide con lo declarado —el servidor nunca vio los archivos, así
 * que no puede confiar en los datos del cliente sin esa verificación— y
 * solo entonces se crea UN Message con todos sus Attachments.
 *
 * Acepta dos formas de payload:
 * - Nueva (recomendada): { conversationId, content?, attachments: [...] }
 *   crea un único mensaje con N adjuntos (y opcionalmente texto), como Discord.
 * - Antigua (retrocompat): { conversationId, storagePath, fileName, ... }
 *   crea un mensaje con un solo adjunto.
 */

type IncomingAttachment = {
  storagePath: string;
  fileName: string;
  fileType?: string;
  fileSize: number;
};

const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_MESSAGE_LENGTH = 5000;

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

  // Normaliza ambos formatos de payload a un array de adjuntos.
  const rawAttachments: unknown[] = Array.isArray(body?.attachments)
    ? body.attachments
    : [
        {
          storagePath: body?.storagePath,
          fileName: body?.fileName,
          fileType: body?.fileType,
          fileSize: body?.fileSize,
        },
      ];

  if (rawAttachments.length === 0) {
    return NextResponse.json({ error: "Se requiere al menos un adjunto" }, { status: 400 });
  }
  if (rawAttachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json(
      { error: `Máximo ${MAX_ATTACHMENTS_PER_MESSAGE} adjuntos por mensaje` },
      { status: 400 },
    );
  }

  // Texto opcional que acompaña a los adjuntos (como el caption de WhatsApp).
  let content: string | null = null;
  if (typeof body?.content === "string") {
    const trimmed = body.content.trim();
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: "El mensaje es demasiado largo" }, { status: 400 });
    }
    content = trimmed.length > 0 ? trimmed : null;
  }

  const attachments: IncomingAttachment[] = [];
  for (const item of rawAttachments) {
    const a = item as Record<string, unknown>;
    const storagePath = a.storagePath;
    const fileName = a.fileName;
    const fileSize = a.fileSize;
    const fileType = a.fileType;

    if (typeof storagePath !== "string" || !storagePath.startsWith(`${conversationId}/`)) {
      return NextResponse.json({ error: "storagePath inválido" }, { status: 400 });
    }
    if (typeof fileName !== "string" || !fileName) {
      return NextResponse.json({ error: "fileName requerido" }, { status: 400 });
    }
    if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json({ error: "fileSize inválido" }, { status: 400 });
    }
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "El archivo supera el límite de 20MB" }, { status: 413 });
    }
    attachments.push({
      storagePath,
      fileName,
      fileSize,
      fileType: typeof fileType === "string" && fileType ? fileType : "application/octet-stream",
    });
  }

  // Repite la validación de pertenencia: no confiar en que el paso de
  // presign siga siendo válido (la sesión pudo cambiar entre ambos pasos).
  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a esta conversación" }, { status: 403 });
  }

  // Verifica en S3 que todos los objetos existan con el tamaño declarado
  // antes de crear nada en la base de datos.
  const verifications = await Promise.all(
    attachments.map((a) => verifyUploadedObject(a.storagePath, a.fileSize)),
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
      content,
      attachments: {
        create: attachments.map((a) => ({
          uploaderId: session.userId,
          fileName: a.fileName,
          fileType: a.fileType ?? "application/octet-stream",
          fileSize: a.fileSize,
          storagePath: a.storagePath,
        })),
      },
    },
    include: { attachments: true, sender: { select: { id: true, username: true } } },
  });

  return NextResponse.json({ success: true, message });
}
