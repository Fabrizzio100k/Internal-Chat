import {
  BROWSER_FORBIDDEN_HEADERS,
  METHODS_WITHOUT_BODY,
  type AuthConfig,
  type ExecFormPart,
  type ExecSpec,
  type Extractor,
  type FormRow,
  type HttpMethod,
  type KeyValueRow,
  type RequestDraft,
} from "@/lib/hombrepost/types";

/* ------------------------------------------------------------------ */
/* Filas de tablas key/value                                           */
/* ------------------------------------------------------------------ */

/**
 * Identificador local. `randomUUID` existe en navegadores modernos y en Node
 * >=19; el fallback cubre contextos no seguros (http sin TLS en navegadores
 * viejos), donde `crypto.randomUUID` no está disponible.
 */
export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function createRow(overrides: Partial<KeyValueRow> = {}): KeyValueRow {
  return { id: createId(), enabled: true, key: "", value: "", ...overrides };
}

export function createFormRow(overrides: Partial<FormRow> = {}): FormRow {
  return {
    id: createId(),
    enabled: true,
    key: "",
    value: "",
    kind: "text",
    fileName: null,
    file: null,
    ...overrides,
  };
}

export function createExtractor(overrides: Partial<Extractor> = {}): Extractor {
  return {
    id: createId(),
    enabled: true,
    source: "body",
    path: "",
    variable: "",
    ...overrides,
  };
}

export function createEmptyDraft(overrides: Partial<RequestDraft> = {}): RequestDraft {
  return {
    id: createId(),
    name: "Nueva petición",
    method: "GET",
    url: "",
    params: [createRow()],
    headers: [createRow()],
    bodyMode: "none",
    bodyText: "",
    formRows: [createFormRow()],
    auth: { mode: "none", token: "", username: "", password: "" },
    transport: "auto",
    followRedirects: true,
    extractors: [createExtractor()],
    expectedStatus: null,
    ...overrides,
  };
}

/** Copia profunda de un borrador con identidad nueva, para duplicar o abrir en pestaña. */
export function cloneDraft(draft: RequestDraft, overrides: Partial<RequestDraft> = {}): RequestDraft {
  return {
    ...draft,
    id: createId(),
    params: draft.params.map((row) => ({ ...row, id: createId() })),
    headers: draft.headers.map((row) => ({ ...row, id: createId() })),
    formRows: draft.formRows.map((row) => ({ ...row, id: createId() })),
    extractors: (draft.extractors ?? []).map((row) => ({ ...row, id: createId() })),
    auth: { ...draft.auth },
    ...overrides,
  };
}

/** Filas con clave utilizable, respetando el check de habilitado. */
function usableRows<T extends KeyValueRow>(rows: T[]): T[] {
  return rows.filter((row) => row.enabled && row.key.trim() !== "");
}

/* ------------------------------------------------------------------ */
/* Variables de entorno {{clave}}                                      */
/* ------------------------------------------------------------------ */

const VARIABLE_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Sustituye `{{clave}}` por el valor de la variable de entorno correspondiente.
 * Las variables desconocidas se dejan intactas para que el error sea visible
 * en la URL final en vez de convertirse en una petición silenciosamente rota.
 */
export function interpolate(text: string, variables: KeyValueRow[]): string {
  if (!text.includes("{{")) return text;
  const lookup = new Map(usableRows(variables).map((row) => [row.key.trim(), row.value]));
  return text.replace(VARIABLE_PATTERN, (match, name: string) => lookup.get(name) ?? match);
}

/** Nombres de variables usadas en el texto que no están definidas. */
export function findMissingVariables(text: string, variables: KeyValueRow[]): string[] {
  const defined = new Set(usableRows(variables).map((row) => row.key.trim()));
  const missing = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!defined.has(match[1])) missing.add(match[1]);
  }
  return [...missing];
}

/* ------------------------------------------------------------------ */
/* Construcción de la petición                                         */
/* ------------------------------------------------------------------ */

/** Añade `?a=b` de la tabla de params a la URL escrita, ya interpolada. */
export function buildRequestUrl(
  rawUrl: string,
  params: KeyValueRow[],
  variables: KeyValueRow[],
): string {
  const interpolated = interpolate(rawUrl, variables).trim();
  const enabled = usableRows(params);
  if (enabled.length === 0) return interpolated;

  const query = enabled
    .map(
      (row) =>
        `${encodeURIComponent(interpolate(row.key, variables).trim())}=${encodeURIComponent(
          interpolate(row.value, variables),
        )}`,
    )
    .join("&");

  const separator = interpolated.includes("?") ? "&" : "?";
  return `${interpolated}${separator}${query}`;
}

/** Extrae el query string de una URL escrita a mano y lo pasa a filas. */
export function extractParamsFromUrl(rawUrl: string): { url: string; params: KeyValueRow[] } {
  const questionMarkIndex = rawUrl.indexOf("?");
  if (questionMarkIndex === -1) return { url: rawUrl, params: [] };

  const base = rawUrl.slice(0, questionMarkIndex);
  const search = new URLSearchParams(rawUrl.slice(questionMarkIndex + 1));
  const params = [...search.entries()].map(([key, value]) => createRow({ key, value }));
  return { url: base, params };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // evita "Maximum call stack size exceeded" con buffers grandes
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Header Authorization derivado de la pestaña Auth, si aplica. */
export function buildAuthHeader(
  auth: AuthConfig,
  variables: KeyValueRow[],
): [string, string] | null {
  if (auth.mode === "bearer") {
    const token = interpolate(auth.token, variables).trim();
    return token ? ["Authorization", `Bearer ${token}`] : null;
  }
  if (auth.mode === "basic") {
    const user = interpolate(auth.username, variables);
    const password = interpolate(auth.password, variables);
    if (!user && !password) return null;
    return ["Authorization", `Basic ${utf8ToBase64(`${user}:${password}`)}`];
  }
  return null;
}

export function bodyAllowedFor(method: HttpMethod): boolean {
  return !METHODS_WITHOUT_BODY.includes(method);
}

/** Content-Type implícito según el modo de body, si el usuario no lo fijó. */
function defaultContentType(draft: RequestDraft): string | null {
  switch (draft.bodyMode) {
    case "json":
      return "application/json";
    case "text":
      return "text/plain;charset=UTF-8";
    case "urlencoded":
      return "application/x-www-form-urlencoded;charset=UTF-8";
    // multipart lo pone el runtime junto con el boundary.
    default:
      return null;
  }
}

export type BuiltRequest = {
  spec: ExecSpec;
  /** Archivos adjuntos en el orden de `parts[].fileIndex`. */
  files: File[];
  /** Avisos para mostrar en la UI antes/después de enviar. */
  warnings: string[];
};

/**
 * Traduce el borrador de la UI al contrato serializable `ExecSpec`, resolviendo
 * variables, auth, content-type y adjuntos.
 */
export function buildRequest(
  draft: RequestDraft,
  variables: KeyValueRow[],
  transport: "server" | "browser",
): BuiltRequest {
  const warnings: string[] = [];
  const url = buildRequestUrl(draft.url, draft.params, variables);

  const headers: [string, string][] = usableRows(draft.headers).map((row) => [
    interpolate(row.key, variables).trim(),
    interpolate(row.value, variables),
  ]);

  const authHeader = buildAuthHeader(draft.auth, variables);
  if (authHeader && !headers.some(([key]) => key.toLowerCase() === "authorization")) {
    headers.push(authHeader);
  }

  const includeBody = bodyAllowedFor(draft.method) && draft.bodyMode !== "none";
  if (!includeBody && draft.bodyMode !== "none") {
    warnings.push(`${draft.method} no envía body; se ignoró el contenido de la pestaña Body.`);
  }

  let bodyKind: ExecSpec["bodyKind"] = "none";
  let bodyText: string | undefined;
  let parts: ExecFormPart[] | undefined;
  const files: File[] = [];

  if (includeBody) {
    if (draft.bodyMode === "json" || draft.bodyMode === "text") {
      bodyKind = "text";
      bodyText = interpolate(draft.bodyText, variables);
    } else if (draft.bodyMode === "urlencoded") {
      bodyKind = "urlencoded";
      bodyText = usableRows(draft.formRows)
        .filter((row) => row.kind === "text")
        .map(
          (row) =>
            `${encodeURIComponent(interpolate(row.key, variables).trim())}=${encodeURIComponent(
              interpolate(row.value, variables),
            )}`,
        )
        .join("&");
    } else if (draft.bodyMode === "multipart") {
      bodyKind = "multipart";
      parts = [];
      for (const row of usableRows(draft.formRows)) {
        if (row.kind === "file") {
          if (!row.file) {
            warnings.push(`El campo "${row.key}" no tiene archivo seleccionado y se omitió.`);
            continue;
          }
          parts.push({
            key: interpolate(row.key, variables).trim(),
            kind: "file",
            value: "",
            fileIndex: files.length,
            fileName: row.file.name,
          });
          files.push(row.file);
        } else {
          parts.push({
            key: interpolate(row.key, variables).trim(),
            kind: "text",
            value: interpolate(row.value, variables),
          });
        }
      }
    }

    const implicitContentType = defaultContentType(draft);
    const hasExplicitContentType = headers.some(([key]) => key.toLowerCase() === "content-type");

    if (draft.bodyMode === "multipart" && hasExplicitContentType) {
      warnings.push(
        "Con multipart el Content-Type lo genera el runtime (incluye el boundary); se ignoró el que pusiste.",
      );
    } else if (implicitContentType && !hasExplicitContentType) {
      headers.push(["Content-Type", implicitContentType]);
    }
  }

  if (transport === "browser") {
    const blocked = headers
      .map(([key]) => key.toLowerCase())
      .filter(
        (key) =>
          BROWSER_FORBIDDEN_HEADERS.includes(key) ||
          key.startsWith("proxy-") ||
          key.startsWith("sec-"),
      );
    if (blocked.length > 0) {
      warnings.push(
        `El navegador no permite escribir estos headers y los ignorará: ${blocked.join(", ")}. Usa el modo servidor si los necesitas.`,
      );
    }
  }

  return {
    spec: {
      method: draft.method,
      url,
      headers,
      bodyKind,
      bodyText,
      parts,
      followRedirects: draft.followRedirects,
    },
    files,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Respuesta                                                           */
/* ------------------------------------------------------------------ */

const TEXTUAL_CONTENT_TYPES = [
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/x-www-form-urlencoded",
  "application/graphql",
  "application/problem+json",
  "image/svg+xml",
];

export function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) return true; // sin content-type, asumir texto es lo más útil
  const value = contentType.toLowerCase();
  if (value.startsWith("text/")) return true;
  if (value.includes("+json") || value.includes("+xml")) return true;
  return TEXTUAL_CONTENT_TYPES.some((type) => value.startsWith(type));
}

export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return value.includes("json");
}

/** Formatea JSON con indentación; devuelve null si el texto no es JSON válido. */
export function tryPrettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/**
 * Mensaje del error de parseo, o null si el JSON es válido (o está vacío).
 * Sirve para avisar en el editor del body antes de enviar, en vez de que el
 * servidor destino responda un 400 confuso.
 */
export function getJsonError(text: string): string | null {
  if (text.trim() === "") return null;
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "JSON inválido";
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Clase de color para el badge de status. */
export function statusToneClassName(status: number): string {
  if (status >= 200 && status < 300) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  }
  if (status >= 300 && status < 400) {
    return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
  }
  if (status >= 400 && status < 500) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-500";
  }
  return "bg-destructive/15 text-destructive";
}

export const METHOD_TONE: Record<HttpMethod, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-amber-600 dark:text-amber-500",
  PUT: "text-sky-600 dark:text-sky-400",
  PATCH: "text-violet-600 dark:text-violet-400",
  DELETE: "text-destructive",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
};
