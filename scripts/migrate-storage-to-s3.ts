/**
 * Migra los adjuntos ya subidos a Supabase Storage hacia el bucket S3.
 * Necesario una sola vez, después de migrar el código de subida/descarga de
 * archivos nuevos (ver src/lib/storage.ts) pero antes de dar de baja el
 * bucket de Supabase, para no dejar rotos los adjuntos ya enviados.
 *
 * Es idempotente: antes de subir un objeto a S3 revisa si ya existe (mismo
 * Key) y lo salta, así se puede re-ejecutar sin re-subir todo si el proceso
 * se interrumpe a la mitad.
 *
 * Requiere en .env:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (origen)
 *   AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (destino)
 *   DB_URL / DIRECT_URL (para leer la tabla Attachment vía Prisma)
 *
 * Ejecutar con: npx tsx scripts/migrate-storage-to-s3.ts
 */
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const SUPABASE_STORAGE_BUCKET = "chat-attachments";

async function objectExistsInS3(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const s3Bucket = process.env.AWS_S3_BUCKET;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  }
  if (!s3Bucket) {
    throw new Error("Falta AWS_S3_BUCKET en .env");
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const prisma = new PrismaClient();

  try {
    const attachments = await prisma.attachment.findMany({
      select: { id: true, storagePath: true, fileName: true, fileType: true },
      orderBy: { createdAt: "asc" },
    });

    console.log(`${attachments.length} adjunto(s) encontrado(s) en la base de datos.`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const attachment of attachments) {
      const key = attachment.storagePath;

      const alreadyInS3 = await objectExistsInS3(s3, s3Bucket, key);
      if (alreadyInS3) {
        skipped++;
        continue;
      }

      const { data, error } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .download(key);

      if (error || !data) {
        console.error(`[FALLÓ] ${key} (adjunto ${attachment.id}): no se pudo descargar de Supabase — ${error?.message ?? "sin datos"}`);
        failed++;
        continue;
      }

      try {
        const arrayBuffer = await data.arrayBuffer();
        await s3.send(
          new PutObjectCommand({
            Bucket: s3Bucket,
            Key: key,
            Body: new Uint8Array(arrayBuffer),
            ContentType: attachment.fileType || "application/octet-stream",
          }),
        );
        migrated++;
        console.log(`[OK] ${key}`);
      } catch (uploadErr) {
        console.error(`[FALLÓ] ${key} (adjunto ${attachment.id}): error subiendo a S3 —`, uploadErr);
        failed++;
      }
    }

    console.log("\n=== Resumen ===");
    console.log(`Migrados:  ${migrated}`);
    console.log(`Omitidos (ya en S3): ${skipped}`);
    console.log(`Fallidos:  ${failed}`);

    if (failed > 0) {
      console.log("\nHay adjuntos que fallaron. Vuelve a correr este script para reintentarlos (es idempotente).");
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Error migrando adjuntos a S3:", error);
  process.exit(1);
});
