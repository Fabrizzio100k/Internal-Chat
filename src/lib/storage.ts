import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB de archivo en claro
// El blob cifrado añade iv (12) + etiqueta GCM (16) al archivo original.
export const MAX_ENCRYPTED_FILE_BYTES = MAX_FILE_SIZE_BYTES + 28;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ref` de un adjunto cifrado: un UUID aleatorio generado en el navegador. */
export function isValidAttachmentRef(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const SIGNED_URL_EXPIRY_SECONDS = 60 * 5; // 5 minutos
const UPLOAD_URL_EXPIRY_SECONDS = 60 * 5; // 5 minutos para completar la subida

function getBucketName(): string {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    throw new Error("Falta AWS_S3_BUCKET en las variables de entorno.");
  }
  return bucket;
}

let cachedClient: S3Client | null = null;

/**
 * Cliente S3 singleton (server-only). Usa las credenciales estándar de AWS
 * (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION vía env vars, o un
 * rol IAM si el runtime lo provee). Nunca importar este módulo desde código
 * de cliente.
 */
function getS3Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  }
  return cachedClient;
}

/**
 * Genera una URL firmada de descarga temporal (5 minutos) para un objeto del
 * bucket. Equivalente a `createSignedUrl` de Supabase Storage: el objeto
 * sigue siendo privado, la URL solo es válida por un tiempo limitado.
 */
export async function getSignedDownloadUrl(
  key: string,
  options?: { downloadFileName?: string },
): Promise<string> {
  const client = getS3Client();
  // Con downloadFileName, S3 responde con Content-Disposition: attachment y el
  // nombre ORIGINAL del archivo. El atributo `download` del <a> se ignora en
  // URLs de otro origen (S3), por eso el nombre debe ir en la propia respuesta.
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ...(options?.downloadFileName
      ? { ResponseContentDisposition: buildContentDisposition(options.downloadFileName) }
      : {}),
  });
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
}

function buildContentDisposition(fileName: string): string {
  const clean = fileName.replace(/[\r\n"]/g, "_");
  const asciiFallback = clean.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/**
 * Genera una URL firmada de SUBIDA (PUT) para que el navegador suba el
 * archivo directo a S3, sin pasar por el servidor de la app. Evita el límite
 * de tamaño de body de las funciones serverless (Vercel) y la doble carga en
 * memoria del servidor que implicaba hacer de proxy del archivo completo.
 *
 * `contentLength` y `contentType` quedan fijados en la firma: S3 rechaza la
 * subida si el Content-Length real del PUT no coincide exactamente con el
 * declarado aquí, así el cliente no puede subir un archivo más grande que el
 * que se validó y firmó server-side.
 */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: UPLOAD_URL_EXPIRY_SECONDS });
}

/**
 * Confirma que un objeto realmente existe en el bucket (y opcionalmente que
 * su tamaño coincide con lo esperado). Se usa al confirmar una subida hecha
 * vía presigned URL: el servidor nunca vio el archivo, así que antes de
 * crear el Message/Attachment en la base de datos verifica con S3 que el
 * PUT del navegador sí se completó.
 */
export async function verifyUploadedObject(
  key: string,
  expectedContentLength: number,
): Promise<boolean> {
  const client = getS3Client();
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: getBucketName(), Key: key }),
    );
    return result.ContentLength === expectedContentLength;
  } catch {
    return false;
  }
}

/**
 * Borra un objeto del bucket (best effort). Se usa al migrar un adjunto antiguo en
 * claro a su versión cifrada: el original en claro no debe quedar en S3.
 */
export async function deleteStoredObject(key: string): Promise<boolean> {
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: key }));
    return true;
  } catch (error) {
    console.error("[storage] no se pudo borrar el objeto antiguo:", key, error);
    return false;
  }
}
