"use client";

// Utilidades de cliente para adjuntos. Los archivos cifrados (E2EE) se descargan de
// S3 como bytes opacos y se DESCIFRAN aquí con la clave que viajó dentro del mensaje.
// Se cachean los bytes ya descifrados (con tope de memoria) y las URLs firmadas, y se
// deduplican peticiones en vuelo, para que re-montar un mensaje (scroll, cambiar de
// chat y volver) no vuelva a descargar ni descifrar.

import { decryptFile } from "@/lib/e2ee/crypto";
import type { AttachmentData } from "@/lib/e2ee/message-types";
import { onIdentityReset } from "@/lib/e2ee/session";

const URL_TTL_MS = 4 * 60 * 1000;
const MAX_BYTES_CACHE = 80 * 1024 * 1024;
const MAX_TEXT_CACHE = 60;

type SignedEntry = { url: string; expires: number };

const urlCache = new Map<string, SignedEntry>();
const urlInflight = new Map<string, Promise<string>>();
const bytesCache = new Map<string, ArrayBuffer>();
const bytesInflight = new Map<string, Promise<ArrayBuffer>>();
const textCache = new Map<string, string>();
let bytesCacheSize = 0;

onIdentityReset(() => {
  urlCache.clear();
  bytesCache.clear();
  textCache.clear();
  bytesCacheSize = 0;
});

function getSignedUrl(attachmentId: string): Promise<string> {
  const cached = urlCache.get(attachmentId);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.url);

  const pending = urlInflight.get(attachmentId);
  if (pending) return pending;

  const promise = fetch(`/api/upload/${attachmentId}`)
    .then(async (res) => {
      if (!res.ok) throw new Error("No se pudo obtener la URL");
      const { url } = (await res.json()) as { url: string };
      urlCache.set(attachmentId, { url, expires: Date.now() + URL_TTL_MS });
      return url;
    })
    .finally(() => urlInflight.delete(attachmentId));

  urlInflight.set(attachmentId, promise);
  return promise;
}

function remember(attachmentId: string, bytes: ArrayBuffer): void {
  if (bytes.byteLength > MAX_BYTES_CACHE) return;
  bytesCache.set(attachmentId, bytes);
  bytesCacheSize += bytes.byteLength;
  // Expulsa los más antiguos hasta volver al tope.
  for (const key of bytesCache.keys()) {
    if (bytesCacheSize <= MAX_BYTES_CACHE) break;
    if (key === attachmentId) continue;
    bytesCacheSize -= bytesCache.get(key)?.byteLength ?? 0;
    bytesCache.delete(key);
  }
}

/** Bytes del archivo ya descifrados (los adjuntos antiguos en claro se devuelven tal cual). */
export function getAttachmentBytes(attachment: AttachmentData): Promise<ArrayBuffer> {
  const cached = bytesCache.get(attachment.id);
  if (cached) return Promise.resolve(cached);

  const pending = bytesInflight.get(attachment.id);
  if (pending) return pending;

  const promise = getSignedUrl(attachment.id)
    .then(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("No se pudo leer el archivo");
      const raw = await res.arrayBuffer();
      const bytes = attachment.crypto
        ? await decryptFile(raw, attachment.crypto.key, attachment.crypto.ref)
        : raw;
      remember(attachment.id, bytes);
      return bytes;
    })
    .finally(() => bytesInflight.delete(attachment.id));

  bytesInflight.set(attachment.id, promise);
  return promise;
}

export async function getAttachmentText(attachment: AttachmentData): Promise<string> {
  const cached = textCache.get(attachment.id);
  if (cached !== undefined) return cached;

  const text = new TextDecoder().decode(await getAttachmentBytes(attachment));
  if (textCache.size >= MAX_TEXT_CACHE) {
    const oldest = textCache.keys().next().value;
    if (oldest !== undefined) textCache.delete(oldest);
  }
  textCache.set(attachment.id, text);
  return text;
}

/** Blob del archivo con su tipo MIME original (para imágenes y descargas). */
export async function getAttachmentBlob(attachment: AttachmentData): Promise<Blob> {
  return new Blob([await getAttachmentBytes(attachment)], {
    type: attachment.fileType || "application/octet-stream",
  });
}

/** Descarga el archivo ya descifrado con su nombre ORIGINAL. */
export async function downloadAttachment(attachment: AttachmentData): Promise<void> {
  const blob = await getAttachmentBlob(attachment);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = attachment.fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Margen para que el navegador inicie la descarga antes de liberar la URL.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
