import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { STORAGE_BUCKET } from "@/lib/storage";

const SIGNED_URL_EXPIRY_SECONDS = 60 * 5; // 5 minutos

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

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(attachment.storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data) {
    return NextResponse.json({ error: "Error generando la URL de descarga" }, { status: 500 });
  }

  return NextResponse.json({
    url: data.signedUrl,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
  });
}
