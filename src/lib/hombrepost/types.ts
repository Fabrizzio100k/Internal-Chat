/**
 * Tipos compartidos entre la UI de HombrePost y el ejecutor server-side
 * (`/api/hombrepost/send`). Módulo isomórfico: nada de imports de servidor.
 */

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Métodos donde un body no tiene sentido (y `fetch` lo rechaza). */
export const METHODS_WITHOUT_BODY: readonly HttpMethod[] = ["GET", "HEAD"];

/**
 * Cómo se dispara la petición:
 * - `server`: la ejecuta un Route Handler. Sin CORS y con control total de
 *   headers, pero "localhost" es el del servidor.
 * - `browser`: la ejecuta el navegador del usuario. Alcanza sus servicios
 *   locales, pero el destino debe permitir CORS y hay headers que el navegador
 *   no deja escribir.
 * - `auto`: elige `browser` para hosts locales y `server` para el resto.
 */
export type Transport = "server" | "browser";
export type TransportPreference = Transport | "auto";

export type KeyValueRow = {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
};

export type FormRow = KeyValueRow & {
  kind: "text" | "file";
  /** Nombre del archivo elegido; se persiste solo como referencia visual. */
  fileName: string | null;
  /** Archivo real en memoria. Nunca se persiste. */
  file?: File | null;
};

export type BodyMode = "none" | "json" | "text" | "urlencoded" | "multipart";

export type AuthMode = "none" | "bearer" | "basic";

export type AuthConfig = {
  mode: AuthMode;
  token: string;
  username: string;
  password: string;
};

/**
 * Regla para sacar un dato de la respuesta y guardarlo en una variable del
 * entorno activo. Es lo que permite encadenar peticiones: hacer login, extraer
 * el token y usarlo como `{{token}}` en las siguientes.
 */
export type Extractor = {
  id: string;
  enabled: boolean;
  /** `body` evalúa un path sobre el JSON; `header` lee un header de respuesta. */
  source: "body" | "header";
  /** `data.items[0].token` para body, o el nombre del header. */
  path: string;
  /** Nombre de la variable de entorno donde se guarda. */
  variable: string;
};

/** Estado completo de una petición en construcción. */
export type RequestDraft = {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  bodyMode: BodyMode;
  bodyText: string;
  formRows: FormRow[];
  auth: AuthConfig;
  transport: TransportPreference;
  followRedirects: boolean;
  extractors: Extractor[];
  /** Status que se espera; si no coincide se marca en la respuesta. */
  expectedStatus: number | null;
};

/* ------------------------------------------------------------------ */
/* Workspace: entornos, colecciones, pestañas e historial              */
/* ------------------------------------------------------------------ */

export type Environment = {
  id: string;
  name: string;
  variables: KeyValueRow[];
};

export type Collection = {
  id: string;
  name: string;
  requests: RequestDraft[];
  collapsed: boolean;
};

/** Pestaña abierta. `origin` apunta a la petición guardada de la que salió. */
export type RequestTab = {
  id: string;
  draft: RequestDraft;
  origin: { collectionId: string; requestId: string } | null;
  dirty: boolean;
};

export type HistoryEntry = {
  id: string;
  at: number;
  method: HttpMethod;
  url: string;
  transport: Transport;
  status: number | null;
  durationMs: number;
  sizeBytes: number;
  error: string | null;
  /** Borrador completo para poder reabrir la petición tal cual se envió. */
  draft: RequestDraft;
};

export const WORKSPACE_VERSION = 2;

export type Workspace = {
  version: typeof WORKSPACE_VERSION;
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  tabs: RequestTab[];
  activeTabId: string | null;
  history: HistoryEntry[];
};

/* ------------------------------------------------------------------ */
/* Contrato con /api/hombrepost/send                                   */
/* ------------------------------------------------------------------ */

export type ExecBodyKind = "none" | "text" | "urlencoded" | "multipart";

export type ExecFormPart = {
  key: string;
  kind: "text" | "file";
  value: string;
  /** Índice del campo `file_<n>` del FormData que acompaña al spec. */
  fileIndex?: number;
  fileName?: string;
};

/**
 * Especificación serializable que la UI manda al ejecutor. Viaja como campo
 * `spec` (JSON) de un multipart/form-data, junto a los archivos `file_0..n`,
 * para poder reenviar adjuntos sin inflarlos en base64.
 */
export type ExecSpec = {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  bodyKind: ExecBodyKind;
  bodyText?: string;
  parts?: ExecFormPart[];
  followRedirects: boolean;
};

export type ExecErrorCode =
  | "INVALID"
  | "LOCAL_BLOCKED"
  | "METADATA_BLOCKED"
  | "TIMEOUT"
  /** El usuario pulsó Cancelar; no es un fallo del destino. */
  | "CANCELLED"
  | "NETWORK"
  | "TOO_LARGE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

export type ExecSuccess = {
  ok: true;
  transport: Transport;
  status: number;
  statusText: string;
  headers: [string, string][];
  /** Cuerpo como texto cuando el content-type es textual. */
  bodyText: string | null;
  /** Cuerpo en base64 cuando es binario. */
  bodyBase64: string | null;
  contentType: string | null;
  sizeBytes: number;
  durationMs: number;
  finalUrl: string;
  redirected: boolean;
  /** `true` si la respuesta se cortó por exceder el límite de tamaño. */
  truncated: boolean;
  /** Avisos no fatales (p. ej. headers que el navegador ignoró). */
  warnings: string[];
};

export type ExecFailure = {
  ok: false;
  transport: Transport;
  error: string;
  code: ExecErrorCode;
  durationMs: number;
  /** Sugerencia accionable para la UI. */
  hint?: string;
};

export type ExecResult = ExecSuccess | ExecFailure;

/** Tope de cuerpo de respuesta que se transporta a la UI. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Tope de tamaño total de archivos adjuntos en una petición. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Headers que el navegador prohíbe escribir vía `fetch`. En modo navegador se
 * avisan en la UI en vez de fallar silenciosamente.
 * https://developer.mozilla.org/docs/Glossary/Forbidden_header_name
 */
export const BROWSER_FORBIDDEN_HEADERS: readonly string[] = [
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
];
