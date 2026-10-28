import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

/**
 * URL firmada de descarga. Para adjuntos cifrados (E2EE) el servidor solo conoce el
 * `ref`: el nombre real, el tipo y la clave van dentro del mensaje cifrado, y el
 * navegador descarga el blob cifrado y lo descifra localmente. Solo los adjuntos
 * anteriores al E2EE (con `fileName` en claro) pueden descargarse con nombre original.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { attachmentId } = await params;

  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { message: { select: { conversationId: true } } },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }

  const participation = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId: attachment.message.conversationId,
        userId: session.userId,
      },
    },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a este archivo" }, { status: 403 });
  }

  const isEncrypted = attachment.ref !== null;
  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";

  let url: string;
  try {
    url = await getSignedDownloadUrl(
      attachment.storagePath,
      !isEncrypted && wantsDownload && attachment.fileName
        ? { downloadFileName: attachment.fileName }
        : undefined,
    );
  } catch {
    return NextResponse.json({ error: "Error generando la URL de descarga" }, { status: 500 });
  }

  return NextResponse.json({
    url,
    encrypted: isEncrypted,
    // null en adjuntos cifrados: el servidor no conoce estos datos.
    fileName: attachment.fileName,
    fileType: attachment.fileType,
  });
}
