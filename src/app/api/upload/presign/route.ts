import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getSignedUploadUrl,
  MAX_ENCRYPTED_FILE_BYTES,
  isValidAttachmentRef,
} from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limit";

// Mismo límite que la confirmación/subida real: máximo 10 subidas por minuto por IP.
const UPLOAD_RATE_LIMIT = 10;
const UPLOAD_RATE_WINDOW_MS = 60 * 1000;

/**
 * Primer paso de la subida de adjuntos (E2EE): el navegador ya CIFRÓ el archivo, así
 * que aquí solo llegan un `ref` aleatorio y el tamaño del blob cifrado. El servidor
 * no recibe nombre, tipo ni contenido: en S3 el objeto se llama `<conversación>/<ref>`
 * y se sube como application/octet-stream.
 *
 * Valida pertenencia a la conversación y tamaño, y devuelve una URL firmada de PUT
 * (S3 rechaza el PUT si el Content-Length real no coincide con el firmado).
 * /api/upload/confirm vuelve a verificar el objeto ya subido antes de crear el mensaje.
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
  const ref = body?.ref;
  const size = body?.size;

  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId requerido" }, { status: 400 });
  }
  if (!isValidAttachmentRef(ref)) {
    return NextResponse.json({ error: "ref inválido" }, { status: 400 });
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "size inválido" }, { status: 400 });
  }
  if (size > MAX_ENCRYPTED_FILE_BYTES) {
    return NextResponse.json({ error: "El archivo supera el límite de 20MB" }, { status: 413 });
  }

  // Validar que el usuario pertenece a la conversación antes de firmar nada.
  const participation = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a esta conversación" }, { status: 403 });
  }

  const storagePath = `${conversationId}/${ref}`;

  // Un ref ya usado nunca se vuelve a firmar: así nadie (ni otro miembro que conozca
  // el ref y la clave) puede sobrescribir un adjunto existente.
  const taken = await prisma.attachment.findFirst({
    where: { storagePath },
    select: { id: true },
  });
  if (taken) {
    return NextResponse.json({ error: "ref ya utilizado" }, { status: 409 });
  }

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUploadUrl(storagePath, "application/octet-stream", size);
  } catch {
    return NextResponse.json({ error: "Error generando la URL de subida" }, { status: 500 });
  }

  return NextResponse.json({ uploadUrl, storagePath });
}
