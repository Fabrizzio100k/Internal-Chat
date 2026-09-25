import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedUploadUrl, MAX_FILE_SIZE_BYTES } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limit";

// Mismo límite que la confirmación/subida real: máximo 10 subidas por minuto por IP.
const UPLOAD_RATE_LIMIT = 10;
const UPLOAD_RATE_WINDOW_MS = 60 * 1000;

/**
 * Primer paso de la subida de adjuntos: valida que el usuario pertenece a la
 * conversación y que el archivo declarado (tamaño, tipo) cumple los límites,
 * y devuelve una URL firmada de PUT para que el navegador suba el archivo
 * directo a S3, sin pasar por esta función serverless.
 *
 * El tamaño real se vuelve a validar en dos lugares más, porque este paso
 * solo valida lo que el cliente *dice* que va a subir:
 * - S3 rechaza el PUT si el Content-Length real no coincide con el firmado.
 * - /api/upload/confirm vuelve a verificar el objeto ya subido antes de
 *   crear el Message/Attachment.
 */
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

  const body = await request.json().catch(() => null);
  const conversationId = body?.conversationId;
  const fileName = body?.fileName;
  const fileType = body?.fileType;
  const fileSize = body?.fileSize;

  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId requerido" }, { status: 400 });
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

  // Validar que el usuario pertenece a la conversación antes de firmar nada.
  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a esta conversación" }, { status: 403 });
  }

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${conversationId}/${randomUUID()}-${safeFileName}`;

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUploadUrl(storagePath, contentType, fileSize);
  } catch {
    return NextResponse.json({ error: "Error generando la URL de subida" }, { status: 500 });
  }

  return NextResponse.json({ uploadUrl, storagePath });
}
