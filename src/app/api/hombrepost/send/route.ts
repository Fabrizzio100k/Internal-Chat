import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isLocalHostClass, parseHttpUrl } from "@/lib/net-guard";
import { resolveHostClass } from "@/lib/net-guard.server";
import { isTextualContentType } from "@/lib/hombrepost/http";
import {
  HTTP_METHODS,
  MAX_RESPONSE_BYTES,
  MAX_UPLOAD_BYTES,
  REQUEST_TIMEOUT_MS,
  type ExecFailure,
  type ExecResult,
} from "@/lib/hombrepost/types";

/**
 * Ejecutor server-side de HombrePost. Recibe una especificación de petición y
 * la reenvía con `fetch`, devolviendo status, headers, tiempos y cuerpo.
 *
 * Es, por definición, un proxy de peticiones arbitrarias: el riesgo aquí es
 * SSRF. Mitigaciones:
 *  - Exige sesión válida (app interna, no expuesta a anónimos).
 *  - Rate limit propio por IP, además del global del proxy.
 *  - Clasifica el host resolviendo DNS y bloquea metadata de nube siempre.
 *  - En producción bloquea loopback/red privada salvo que se habilite
 *    explícitamente con HOMBREPOST_ALLOW_PRIVATE=true; la UI cae entonces al
 *    modo navegador, que es el correcto para alcanzar el localhost del usuario.
 *  - Timeout y tope de tamaño de respuesta.
 */

// Uso interactivo intenso pero acotado: 120 peticiones por minuto por IP.
const SEND_RATE_LIMIT = 120;
const SEND_RATE_WINDOW_MS = 60 * 1000;

const formPartSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(["text", "file"]),
  value: z.string().default(""),
  fileIndex: z.number().int().min(0).max(49).optional(),
  fileName: z.string().optional(),
});

const specSchema = z.object({
  method: z.enum(HTTP_METHODS),
  url: z.string().min(1).max(4096),
  headers: z.array(z.tuple([z.string().min(1).max(256), z.string().max(8192)])).max(60),
  bodyKind: z.enum(["none", "text", "urlencoded", "multipart"]),
  bodyText: z.string().max(2 * 1024 * 1024).optional(),
  parts: z.array(formPartSchema).max(50).optional(),
  followRedirects: z.boolean(),
});

function failure(
  error: string,
  code: ExecFailure["code"],
  status: number,
  extra: { hint?: string; durationMs?: number } = {},
) {
  const body: ExecFailure = {
    ok: false,
    transport: "server",
    error,
    code,
    durationMs: extra.durationMs ?? 0,
    hint: extra.hint,
  };
  return NextResponse.json(body, { status });
}

/**
 * Headers que no se reenvían nunca: los de conexión (los gestiona undici) y
 * los que delatarían o suplantarían la infraestructura del proxy.
 */
const NON_FORWARDABLE_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "expect",
]);

function isPrivateNetworkAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.HOMBREPOST_ALLOW_PRIVATE === "true";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return failure("No autenticado", "UNAUTHORIZED", 401);
  }

  const rateLimit = await checkRateLimit("hombrepost-send", SEND_RATE_LIMIT, SEND_RATE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return failure(
      `Demasiadas peticiones. Espera ${rateLimit.retryAfterSeconds} segundos.`,
      "RATE_LIMITED",
      429,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("Payload inválido", "INVALID", 400);
  }

  const rawSpec = formData.get("spec");
  if (typeof rawSpec !== "string") {
    return failure("Falta la especificación de la petición", "INVALID", 400);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawSpec);
  } catch {
    return failure("La especificación no es JSON válido", "INVALID", 400);
  }

  const specResult = specSchema.safeParse(parsedJson);
  if (!specResult.success) {
    return failure(
      specResult.error.issues[0]?.message ?? "Especificación inválida",
      "INVALID",
      400,
    );
  }
  const spec = specResult.data;

  const target = parseHttpUrl(spec.url);
  if (!target.ok) {
    return failure(target.error, "INVALID", 400);
  }

  const hostClass = await resolveHostClass(target.url.hostname);
  if (hostClass === "metadata") {
    return failure(
      "Host bloqueado: endpoint de metadatos de nube",
      "METADATA_BLOCKED",
      403,
    );
  }
  if (hostClass === "invalid") {
    return failure("Host inválido", "INVALID", 400);
  }
  if (isLocalHostClass(hostClass) && !isPrivateNetworkAllowed()) {
    return failure(
      "Este despliegue no permite peticiones a redes locales desde el servidor",
      "LOCAL_BLOCKED",
      403,
      {
        hint: "Cambia el modo de envío a 'Navegador': tu propio navegador sí puede alcanzar localhost. El destino debe permitir CORS.",
      },
    );
  }

  // Reconstrucción del body según el modo.
  let body: BodyInit | undefined;
  if (spec.bodyKind === "text" || spec.bodyKind === "urlencoded") {
    body = spec.bodyText ?? "";
  } else if (spec.bodyKind === "multipart") {
    const outgoing = new FormData();
    let uploadedBytes = 0;
    for (const part of spec.parts ?? []) {
      if (part.kind === "file" && part.fileIndex !== undefined) {
        const file = formData.get(`file_${part.fileIndex}`);
        if (!(file instanceof File)) {
          return failure(`Falta el archivo del campo "${part.key}"`, "INVALID", 400);
        }
        uploadedBytes += file.size;
        if (uploadedBytes > MAX_UPLOAD_BYTES) {
          return failure("Los adjuntos superan el límite de 10 MB", "TOO_LARGE", 413);
        }
        outgoing.append(part.key, file, part.fileName ?? file.name);
      } else {
        outgoing.append(part.key, part.value);
      }
    }
    body = outgoing;
  }

  const outgoingHeaders = new Headers();
  for (const [key, value] of spec.headers) {
    const lower = key.toLowerCase();
    if (NON_FORWARDABLE_HEADERS.has(lower)) continue;
    // Con multipart, el Content-Type (con boundary) lo pone el runtime.
    if (spec.bodyKind === "multipart" && lower === "content-type") continue;
    try {
      outgoingHeaders.append(key, value);
    } catch {
      return failure(`Header inválido: ${key}`, "INVALID", 400);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(target.url, {
      method: spec.method,
      headers: outgoingHeaders,
      body,
      redirect: spec.followRedirects ? "follow" : "manual",
      signal: controller.signal,
      cache: "no-store",
    });

    // Lectura acotada: un destino malicioso o un dump enorme no deben tumbar
    // la función por memoria.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;

    if (reader) {
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
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const durationMs = performance.now() - startedAt;
    const contentType = response.headers.get("content-type");
    const isText = isTextualContentType(contentType);

    // `headers.entries()` une varios Set-Cookie en un solo valor separado por
    // comas, lo que corrompe cookies con `Expires` (que llevan comas). La API
    // correcta es getSetCookie(), que devuelve cada uno por separado.
    const responseHeaders: [string, string][] = [];
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === "set-cookie") continue;
      responseHeaders.push([key, value]);
    }
    const setCookies =
      (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      responseHeaders.push(["set-cookie", cookie]);
    }

    const result: ExecResult = {
      ok: true,
      transport: "server",
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyText: isText ? new TextDecoder().decode(bytes) : null,
      bodyBase64: isText ? null : Buffer.from(bytes).toString("base64"),
      contentType,
      sizeBytes: bytes.byteLength,
      durationMs,
      finalUrl: response.url || target.url.toString(),
      redirected: response.redirected,
      truncated,
      warnings: isLocalHostClass(hostClass)
        ? ["Ejecutado desde el servidor: 'localhost' aquí es la máquina que corre la app."]
        : [],
    };

    return NextResponse.json(result);
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    const aborted = error instanceof Error && error.name === "AbortError";
    if (aborted) {
      return failure(
        `La petición excedió el tiempo límite de ${REQUEST_TIMEOUT_MS / 1000} s`,
        "TIMEOUT",
        504,
        { durationMs },
      );
    }
    const cause = error instanceof Error ? error.message : "Error desconocido";
    return failure(`No se pudo completar la petición: ${cause}`, "NETWORK", 502, {
      durationMs,
      hint: "Revisa que el host exista y esté accesible desde el servidor.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
