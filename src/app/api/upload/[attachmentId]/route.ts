import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

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
    include: { message: true },
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

  let url: string;
  try {
    url = await getSignedDownloadUrl(attachment.storagePath);
  } catch {
    return NextResponse.json({ error: "Error generando la URL de descarga" }, { status: 500 });
  }

  return NextResponse.json({
    url,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
  });
}
