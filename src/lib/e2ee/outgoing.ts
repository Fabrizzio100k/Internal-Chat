"use client";

import { sendMessageAction, editMessageAction } from "@/lib/actions/messages";
import { FILE_OVERHEAD_BYTES, encryptFile } from "@/lib/e2ee/crypto";
import { invalidateConversation } from "@/lib/e2ee/conversation-keys";
import { describeE2eeError, encryptPayload } from "@/lib/e2ee/messages";
import type { MessagePayload, PayloadAttachment } from "@/lib/e2ee/message-types";
import type {
  EditMessageResult,
  SendErrorCode,
  SendMessageResult,
  WireMessage,
} from "@/lib/types/messages";

/**
 * Envío: todo se cifra AQUÍ, en el navegador, antes de salir. Lo que viaja por la red
 * (y lo que ve el servidor, Supabase o cualquier proxy) es solo texto cifrado.
 */

const MAX_ATTEMPTS = 3;

/** Códigos que se resuelven refrescando la clave de la conversación y reintentando. */
function isRetryable(code?: SendErrorCode): boolean {
  return code === "stale_epoch" || code === "rotation_pending" || code === "no_keys";
}

export async function sendTextMessage(
  conversationId: string,
  text: string,
): Promise<SendMessageResult> {
  const payload: MessagePayload = { v: 1, text };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let encrypted: { ciphertext: string; keyEpoch: number };
    try {
      encrypted = await encryptPayload(conversationId, payload);
    } catch (error) {
      return { success: false, error: describeE2eeError(error) };
    }
    const result = await sendMessageAction(conversationId, encrypted.ciphertext, encrypted.keyEpoch);
    if (result.success || !isRetryable(result.code)) return result;
    invalidateConversation(conversationId);
  }
  return { success: false, error: "La clave de la conversación cambió. Intenta de nuevo." };
}

export async function editTextMessage(
  messageId: string,
  conversationId: string,
  text: string,
): Promise<EditMessageResult> {
  const payload: MessagePayload = { v: 1, text };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let encrypted: { ciphertext: string; keyEpoch: number };
    try {
      encrypted = await encryptPayload(conversationId, payload);
    } catch (error) {
      return { success: false, error: describeE2eeError(error) };
    }
    const result = await editMessageAction(messageId, encrypted.ciphertext, encrypted.keyEpoch);
    if (result.success || !isRetryable(result.code)) return result;
    invalidateConversation(conversationId);
  }
  return { success: false, error: "La clave de la conversación cambió. Intenta de nuevo." };
}

export type UploadedFile = { meta: PayloadAttachment; encSize: number };

/** Cifra bytes ya en memoria y los sube a S3 con una URL firmada. El servidor solo ve bytes opacos. */
export async function encryptAndUploadBytes(
  conversationId: string,
  data: ArrayBuffer,
  name: string,
  type: string,
): Promise<UploadedFile> {
  const ref = crypto.randomUUID();
  const { blob, key } = await encryptFile(data, ref);

  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Solo ref y tamaño cifrado: ni nombre ni tipo ni contenido salen del navegador.
    body: JSON.stringify({ conversationId, ref, size: blob.length }),
  });
  const presign = await presignRes.json().catch(() => ({}));
  if (!presignRes.ok) throw new Error(presign.error ?? `No se pudo subir "${name}"`);

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Blob([blob]),
  });
  if (!putRes.ok) throw new Error(`No se pudo subir "${name}"`);

  return {
    meta: { ref, name, type: type || "application/octet-stream", size: data.byteLength, key },
    encSize: data.byteLength + FILE_OVERHEAD_BYTES,
  };
}

export async function encryptAndUploadFile(
  conversationId: string,
  file: File,
): Promise<UploadedFile> {
  return encryptAndUploadBytes(conversationId, await file.arrayBuffer(), file.name, file.type);
}

export type SendFilesResult =
  | { success: true; message: WireMessage; payload: MessagePayload }
  | { success: false; error: string };

/** Mensaje con archivos (y texto opcional): sube cada archivo cifrado y luego confirma. */
export async function sendFilesMessage(
  conversationId: string,
  text: string,
  files: File[],
): Promise<SendFilesResult> {
  let uploaded: UploadedFile[];
  try {
    uploaded = await Promise.all(files.map((file) => encryptAndUploadFile(conversationId, file)));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Error subiendo los adjuntos" };
  }

  const payload: MessagePayload = {
    v: 1,
    text: text || null,
    attachments: uploaded.map((u) => u.meta),
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let encrypted: { ciphertext: string; keyEpoch: number };
    try {
      encrypted = await encryptPayload(conversationId, payload);
    } catch (error) {
      return { success: false, error: describeE2eeError(error) };
    }

    const res = await fetch("/api/upload/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        ciphertext: encrypted.ciphertext,
        keyEpoch: encrypted.keyEpoch,
        attachments: uploaded.map((u) => ({ ref: u.meta.ref, encSize: u.encSize })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true, message: data.message, payload };
    if (isRetryable(data.code)) {
      invalidateConversation(conversationId);
      continue;
    }
    return { success: false, error: data.error ?? "No se pudo enviar los adjuntos" };
  }
  return { success: false, error: "La clave de la conversación cambió. Intenta de nuevo." };
}
