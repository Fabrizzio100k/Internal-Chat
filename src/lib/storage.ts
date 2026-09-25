import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB, debe coincidir con cualquier límite configurado en el bucket

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
export async function getSignedDownloadUrl(key: string): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: getBucketName(), Key: key });
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
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
