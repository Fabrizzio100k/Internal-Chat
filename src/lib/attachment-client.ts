// Utilidades de cliente para adjuntos: cachea las URLs firmadas (válidas 5 min)
// y el texto de previews, y deduplica peticiones en vuelo. Así, re-montar un
// mensaje (scroll, cambiar de chat y volver) no dispara más fetch a la API ni a S3.

const URL_TTL_MS = 4 * 60 * 1000;
const MAX_TEXT_CACHE = 60;

type SignedEntry = { url: string; expires: number };

const urlCache = new Map<string, SignedEntry>();
const urlInflight = new Map<string, Promise<string>>();
const textCache = new Map<string, string>();
const textInflight = new Map<string, Promise<string>>();

export function getAttachmentUrl(attachmentId: string): Promise<string> {
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

export function getAttachmentText(attachmentId: string): Promise<string> {
  const cached = textCache.get(attachmentId);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = textInflight.get(attachmentId);
  if (pending) return pending;

  const promise = getAttachmentUrl(attachmentId)
    .then((url) => fetch(url))
    .then((res) => {
      if (!res.ok) throw new Error("No se pudo leer el archivo");
      return res.text();
    })
    .then((text) => {
      if (textCache.size >= MAX_TEXT_CACHE) {
        const oldest = textCache.keys().next().value;
        if (oldest !== undefined) textCache.delete(oldest);
      }
      textCache.set(attachmentId, text);
      return text;
    })
    .finally(() => textInflight.delete(attachmentId));

  textInflight.set(attachmentId, promise);
  return promise;
}

/**
 * Descarga un adjunto con su nombre ORIGINAL. El servidor firma la URL con
 * Content-Disposition: attachment; filename=<nombre original>, porque el
 * atributo `download` se ignora en URLs de otro origen (S3).
 */
export async function downloadAttachment(attachmentId: string): Promise<void> {
  const res = await fetch(`/api/upload/${attachmentId}?download=1`);
  if (!res.ok) throw new Error("No se pudo descargar");
  const { url, fileName } = (await res.json()) as { url: string; fileName: string };
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
