/**
 * Script único para crear el bucket de Supabase Storage usado por los adjuntos del chat.
 * Ejecutar con: npx tsx scripts/setup-storage.ts
 * Es idempotente: si el bucket ya existe, no falla.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const BUCKET_NAME = "chat-attachments";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw listError;
  }

  const exists = buckets.some((bucket) => bucket.name === BUCKET_NAME);

  if (exists) {
    console.log(`El bucket "${BUCKET_NAME}" ya existe. Nada que hacer.`);
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
    public: false,
    fileSizeLimit: "20MB",
  });

  if (createError) {
    throw createError;
  }

  console.log(`Bucket "${BUCKET_NAME}" creado correctamente (privado, límite 20MB por archivo).`);
}

main().catch((error) => {
  console.error("Error configurando el bucket de Storage:", error);
  process.exit(1);
});
