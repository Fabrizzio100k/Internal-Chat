import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyUploadedObject, MAX_FILE_SIZE_BYTES } from "@/lib/storage";

/**
 * Segundo paso de la subida de adjuntos: el navegador ya subió el archivo
 * directo a S3 usando la URL firmada de /api/upload/presign. Aquí se
 * verifica con S3 (HeadObject) que el objeto realmente existe y que su
 * tamaño coincide con lo declarado —el servidor nunca vio el archivo, así
 * que no puede confiar en los datos del cliente sin esa verificación— y
 * solo entonces se crea el Message y su Attachment.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const conversationId = body?.conversationId;
  const storagePath = body?.storagePath;
  const fileName = body?.fileName;
  const fileType = body?.fileType;
  const fileSize = body?.fileSize;

  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId requerido" }, { status: 400 });
  }
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

  const contentType = typeof fileType === "string" && fileType ? fileType : "application/octet-stream";

  // Repite la validación de pertenencia: no confiar en que el paso de
  // presign siga siendo válido (la sesión pudo cambiar entre ambos pasos).
  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a esta conversación" }, { status: 403 });
  }

  const uploadCompleted = await verifyUploadedObject(storagePath, fileSize);
  if (!uploadCompleted) {
    return NextResponse.json(
      { error: "El archivo no se subió correctamente. Intenta de nuevo." },
      { status: 409 },
    );
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: session.userId,
      content: null,
      attachments: {
        create: {
          uploaderId: session.userId,
          fileName,
          fileType: contentType,
          fileSize,
          storagePath,
        },
      },
    },
    include: { attachments: true, sender: { select: { id: true, username: true } } },
  });

  return NextResponse.json({ success: true, message });
}
