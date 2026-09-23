import { isLocalHostClass, parseHttpUrl } from "@/lib/net-guard";
import { bytesToBase64, isTextualContentType } from "@/lib/hombrepost/http";
import {
  BROWSER_FORBIDDEN_HEADERS,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  type ExecFailure,
  type ExecResult,
  type ExecSpec,
  type Transport,
  type TransportPreference,
} from "@/lib/hombrepost/types";

export const SEND_ENDPOINT = "/api/hombrepost/send";

/**
 * Traduce un aborto a un fallo con causa concreta. Se aborta con una razón
 * explícita (`TimeoutError` vs `AbortError`) para poder distinguir "el destino
 * no respondió" de "el usuario pulsó Cancelar", que son problemas distintos.
 * Se inspecciona `signal.reason` antes que el error porque es la fuente
 * fiable: algunos runtimes rechazan con un AbortError genérico.
 */
function classifyAbort(
  error: unknown,
  signal: AbortSignal,
  transport: Transport,
  durationMs: number,
): ExecFailure | null {
  const reason: unknown = signal.aborted ? signal.reason : undefined;
  const name =
    (reason instanceof DOMException ? reason.name : undefined) ??
    (error instanceof DOMException ? error.name : undefined);

  if (name === "TimeoutError") {
    return {
      ok: false,
      transport,
      error: `El destino no respondió en ${REQUEST_TIMEOUT_MS / 1000} s`,
      code: "TIMEOUT",
      durationMs,
      hint: "El tope lo aplica HombrePost, no el servidor destino. Si la operación es lenta de por sí, prueba con menos datos.",
    };
  }
  if (name === "AbortError") {
    return {
      ok: false,
      transport,
      error: "Cancelaste la petición",
      code: "CANCELLED",
      durationMs,
    };
  }
  return null;
}

/**
 * Decide quién ejecuta la petición. En `auto`, los hosts locales/privados van
 * por el navegador (que sí vive en la máquina del usuario) y el resto por el
 * servidor (sin CORS y con control total de headers).
 */
export function resolveTransport(preference: TransportPreference, url: string): Transport {
  if (preference !== "auto") return preference;
  const parsed = parseHttpUrl(url);
  if (!parsed.ok) return "server";
  return isLocalHostClass(parsed.hostClass) ? "browser" : "server";
}

/** Construye el FormData que viaja al ejecutor server-side. */
function buildServerPayload(spec: ExecSpec, files: File[]): FormData {
  const payload = new FormData();
  payload.set("spec", JSON.stringify(spec));
  files.forEach((file, index) => {
    payload.append(`file_${index}`, file, file.name);
  });
  return payload;
}

/** Construye el body nativo para el `fetch` del navegador. */
function buildBrowserBody(spec: ExecSpec, files: File[]): BodyInit | undefined {
  if (spec.bodyKind === "none") return undefined;
  if (spec.bodyKind === "multipart") {
    const form = new FormData();
    for (const part of spec.parts ?? []) {
      if (part.kind === "file" && part.fileIndex !== undefined) {
        const file = files[part.fileIndex];
        if (file) form.append(part.key, file, file.name);
      } else {
        form.append(part.key, part.value);
      }
    }
    return form;
  }
  return spec.bodyText ?? "";
}

async function readCappedBody(
  response: Response,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), truncated: false };

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > MAX_RESPONSE_BYTES) {
      chunks.push(value.subarray(0, MAX_RESPONSE_BYTES - total));
      total = MAX_RESPONSE_BYTES;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

/**
 * Ejecuta la petición desde el navegador del usuario. Es el único modo capaz de
 * alcanzar `localhost` cuando la app está desplegada, al costo de depender de
 * CORS y de no poder escribir headers prohibidos.
 */
export async function sendViaBrowser(
  spec: ExecSpec,
  files: File[],
  signal: AbortSignal,
): Promise<ExecResult> {
  const startedAt = performance.now();
  const warnings: string[] = [];

  const headers = new Headers();
  for (const [key, value] of spec.headers) {
    const lower = key.toLowerCase();
    if (BROWSER_FORBIDDEN_HEADERS.includes(lower)) continue;
    if (spec.bodyKind === "multipart" && lower === "content-type") continue;
    try {
      headers.set(key, value);
    } catch {
      warnings.push(`Header inválido para el navegador: ${key}`);
    }
  }

  try {
    const response = await fetch(spec.url, {
      method: spec.method,
      headers,
      body: buildBrowserBody(spec, files),
      redirect: spec.followRedirects ? "follow" : "manual",
      signal,
      credentials: "omit",
      cache: "no-store",
    });

    const { bytes, truncated } = await readCappedBody(response);
    const durationMs = performance.now() - startedAt;
    const contentType = response.headers.get("content-type");
    const responseHeaders = [...response.headers.entries()] as [string, string][];

    if (response.type === "opaqueredirect") {
      warnings.push(
        "Con redirecciones en manual el navegador entrega una respuesta opaca: no expone status ni headers.",
      );
    }
    if (responseHeaders.length <= 2) {
      warnings.push(
        "El servidor destino expone pocos headers. En modo navegador solo se leen los listados en Access-Control-Expose-Headers.",
      );
    }

    const isText = isTextualContentType(contentType);

    return {
      ok: true,
      transport: "browser",
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyText: isText ? new TextDecoder().decode(bytes) : null,
      bodyBase64: isText ? null : bytesToBase64(bytes),
      contentType,
      sizeBytes: bytes.byteLength,
      durationMs,
      finalUrl: response.url || spec.url,
      redirected: response.redirected,
      truncated,
      warnings,
    };
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    const aborted = classifyAbort(error, signal, "browser", durationMs);
    if (aborted) return aborted;
    return {
      ok: false,
      transport: "browser",
      error: error instanceof Error ? error.message : "Error de red",
      code: "NETWORK",
      durationMs,
      hint: "El navegador no da detalles por seguridad. Suele ser CORS (el destino debe responder Access-Control-Allow-Origin), el servicio caído, o el bloqueo de red privada de Chrome. Prueba el modo servidor si el destino es público.",
    };
  }
}

/** Ejecuta la petición en el servidor a través del Route Handler. */
export async function sendViaServer(
  spec: ExecSpec,
  files: File[],
  signal: AbortSignal,
): Promise<ExecResult> {
  const startedAt = performance.now();
  try {
    const response = await fetch(SEND_ENDPOINT, {
      method: "POST",
      body: buildServerPayload(spec, files),
      signal,
    });

    const result = (await response.json()) as ExecResult;
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    const aborted = classifyAbort(error, signal, "server", durationMs);
    if (aborted) return aborted;
    return {
      ok: false,
      transport: "server",
      error: "No se pudo contactar al ejecutor de HombrePost",
      code: "NETWORK",
      durationMs,
      hint: "Revisa la consola del servidor: puede ser un error del route handler o un límite de la plataforma (tamaño del payload o duración máxima de la función).",
    };
  }
}

export type SendOptions = {
  spec: ExecSpec;
  files: File[];
  transport: Transport;
  signal: AbortSignal;
};

export async function sendRequest({
  spec,
  files,
  transport,
  signal,
}: SendOptions): Promise<ExecResult> {
  return transport === "browser"
    ? sendViaBrowser(spec, files, signal)
    : sendViaServer(spec, files, signal);
}

/**
 * AbortController con timeout propio, para no depender del destino. El aborto
 * por tiempo usa `TimeoutError` para poder diferenciarlo del aborto manual.
 */
export function createTimeoutController(timeoutMs = REQUEST_TIMEOUT_MS): {
  controller: AbortController;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(`Tiempo límite de ${timeoutMs / 1000} s excedido`, "TimeoutError"),
    );
  }, timeoutMs);
  return { controller, clear: () => clearTimeout(timer) };
}

/** Cancelación explícita del usuario (botón Cancelar). */
export function abortByUser(controller: AbortController): void {
  controller.abort(new DOMException("Cancelada por el usuario", "AbortError"));
}
