"use client";

import {
  listLegacyOwnMessagesAction,
  migrateMessageAction,
} from "@/lib/actions/migration";
import { invalidateConversation } from "@/lib/e2ee/conversation-keys";
import { encryptPayload } from "@/lib/e2ee/messages";
import type { MessagePayload } from "@/lib/e2ee/message-types";
import { encryptAndUploadBytes } from "@/lib/e2ee/outgoing";
import type { WireMessage } from "@/lib/types/messages";

/**
 * Migración al E2EE de MIS mensajes y archivos antiguos (en claro en el servidor).
 * El servidor no puede cifrarlos por mí (no tiene las claves), así que cada usuario
 * migra los suyos en segundo plano al abrir la app: descarga el contenido antiguo, lo
 * cifra aquí, sube la versión cifrada y el servidor borra el original (texto y S3).
 * Cuando todos los usuarios se conecten una vez, no queda nada en claro.
 */

export type MigrationProgress = { running: boolean; migrated: number; failed: number; remaining: number };

let progress: MigrationProgress = { running: false, migrated: 0, failed: 0, remaining: 0 };
const listeners = new Set<(p: MigrationProgress) => void>();

function setProgress(next: MigrationProgress): void {
  progress = next;
  listeners.forEach((listener) => listener(progress));
}

export function getMigrationProgress(): MigrationProgress {
  return progress;
}

export function subscribeMigration(listener: (p: MigrationProgress) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const STEP_DELAY_MS = 500; // no saturar el límite de peticiones por IP

async function downloadLegacyAttachment(attachmentId: string): Promise<ArrayBuffer> {
  const meta = await fetch(`/api/upload/${attachmentId}`);
  if (!meta.ok) throw new Error("No se pudo obtener el adjunto antiguo");
  const { url } = (await meta.json()) as { url: string };
  const file = await fetch(url);
  if (!file.ok) throw new Error("No se pudo descargar el adjunto antiguo");
  return file.arrayBuffer();
}

/** Migra un mensaje. Devuelve false si debe omitirse esta conversación. */
async function migrateOne(wire: WireMessage): Promise<void> {
  const legacyAttachments = wire.attachments.filter((a) => a.ref === null);

  const uploaded = [];
  for (const attachment of legacyAttachments) {
    const bytes = await downloadLegacyAttachment(attachment.id);
    uploaded.push(
      await encryptAndUploadBytes(
        wire.conversationId,
        bytes,
        attachment.fileName ?? "archivo",
        attachment.fileType ?? "application/octet-stream",
      ),
    );
  }

  const payload: MessagePayload = {
    v: 1,
    text: wire.content,
    ...(uploaded.length > 0 ? { attachments: uploaded.map((u) => u.meta) } : {}),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const { ciphertext, keyEpoch } = await encryptPayload(wire.conversationId, payload);
    const result = await migrateMessageAction({
      messageId: wire.id,
      ciphertext,
      keyEpoch,
      attachments: uploaded.map((u, i) => ({
        id: legacyAttachments[i].id,
        ref: u.meta.ref,
        encSize: u.encSize,
      })),
    });
    if (result.success) return;
    if (result.code === "stale_epoch" || result.code === "rotation_pending") {
      invalidateConversation(wire.conversationId);
      continue;
    }
    throw new Error(result.error ?? "No se pudo migrar el mensaje");
  }
  throw new Error("La clave de la conversación cambió demasiadas veces");
}

/** Migra todos mis mensajes antiguos. Seguro de llamar varias veces. */
export async function runLegacyMigration(signal: AbortSignal): Promise<void> {
  if (progress.running) return;
  setProgress({ running: true, migrated: 0, failed: 0, remaining: 0 });

  // Conversaciones que no se pueden cifrar ahora (p. ej. alguien sin claves): se omiten.
  const skipped = new Set<string>();
  let migrated = 0;
  let failed = 0;

  try {
    for (;;) {
      if (signal.aborted) return;
      const batch = await listLegacyOwnMessagesAction([...skipped]);
      setProgress({ running: true, migrated, failed, remaining: batch.remaining });
      if (batch.messages.length === 0) return;

      let succeeded = 0;
      for (const wire of batch.messages) {
        if (signal.aborted) return;
        if (skipped.has(wire.conversationId)) continue;
        try {
          await migrateOne(wire);
          migrated++;
          succeeded++;
        } catch (error) {
          console.error("[migración E2EE] mensaje omitido:", wire.id, error);
          failed++;
          skipped.add(wire.conversationId);
        }
        setProgress({ running: true, migrated, failed, remaining: batch.remaining });
        await sleep(STEP_DELAY_MS);
      }
      if (succeeded === 0) return; // nada avanzó: evita un bucle infinito
    }
  } finally {
    setProgress({ ...progress, running: false });
  }
}
