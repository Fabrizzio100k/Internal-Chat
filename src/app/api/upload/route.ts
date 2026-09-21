import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { STORAGE_BUCKET, MAX_FILE_SIZE_BYTES } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limit";

// Spam de archivos: máximo 10 subidas por minuto por IP.
const UPLOAD_RATE_LIMIT = 10;
const UPLOAD_RATE_WINDOW_MS = 60 * 1000;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit("upload", UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Demasiadas subidas. Espera ${rateLimit.retryAfterSeconds} segundos.` },
      { status: 429 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const conversationId = formData.get("conversationId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Archivo inválido" }, { status: 400 });
  }
  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId requerido" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "El archivo supera el límite de 20MB" }, { status: 413 });
  }

  // Validar que el usuario pertenece a la conversación antes de aceptar el archivo.
  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a esta conversación" }, { status: 403 });
  }

  const supabase = createSupabaseServiceClient();

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${conversationId}/${randomUUID()}-${safeFileName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: "Error subiendo el archivo" }, { status: 500 });
  }

  // Crea el mensaje y su adjunto asociado en una sola transacción.
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: session.userId,
      content: null,
      attachments: {
        create: {
          uploaderId: session.userId,
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          storagePath,
        },
      },
    },
    include: { attachments: true, sender: { select: { id: true, username: true } } },
  });

  return NextResponse.json({ success: true, message });
}
