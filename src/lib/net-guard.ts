/**
 * Clasificación de hosts para decidir si una URL puede ser consultada desde el
 * servidor. Módulo isomórfico a propósito (sin `node:dns`, sin `server-only`):
 * la UI de HombrePost lo usa para detectar en el navegador que una URL apunta a
 * la red local y sugerir el modo de envío correcto, y los Route Handlers lo usan
 * como guard anti-SSRF.
 *
 * Para el guard server-side real, usar `resolveHostClass` de `net-guard.server.ts`,
 * que además resuelve DNS (un host público puede apuntar a 127.0.0.1).
 */
export type HostClass =
  /** Internet pública: siempre alcanzable desde el servidor. */
  | "public"
  /** localhost / 127.0.0.0/8 / ::1 */
  | "loopback"
  /** RFC1918, link-local, ULA IPv6, .local/.internal */
  | "private"
  /** Endpoint de metadatos de nube (AWS/GCP/Azure): jamás alcanzable. */
  | "metadata"
  /** Host vacío o sin forma válida. */
  | "invalid";

const METADATA_IPS = new Set(["169.254.169.254", "fd00:ec2::254"]);

/** Quita los corchetes que la URL estándar deja en los hostnames IPv6. */
function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function classifyIpv4(a: number, b: number): HostClass {
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "private"; // link-local (metadata ya se filtró antes)
  if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT, RFC6598
  if (a === 0) return "invalid";
  if (a >= 224) return "invalid"; // multicast y reservado
  return "public";
}

/**
 * Clasifica un hostname tal como lo devuelve `new URL(...).hostname`.
 * El parser de URL ya normaliza formas raras de IPv4 (decimal, hexadecimal,
 * octal), así que aquí solo hay que interpretar la forma canónica.
 */
export function classifyHost(hostname: string): HostClass {
  const host = normalizeHostname(hostname);
  if (!host) return "invalid";

  if (METADATA_IPS.has(host)) return "metadata";
  if (host === "metadata.google.internal") return "metadata";

  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "loopback";
  if (host.endsWith(".local") || host.endsWith(".internal")) return "private";

  // IPv6 privadas: link-local (fe80::/10) y unique local (fc00::/7).
  if (/^fe[89ab][0-9a-f]:/.test(host)) return "private";
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return "private";

  // IPv4 mapeada en IPv6 (::ffff:127.0.0.1) → clasificar por la parte IPv4.
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return classifyHost(mapped[1]);
  if (host === "::") return "invalid";

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return "invalid";
    return classifyIpv4(octets[0], octets[1]);
  }

  // Forma decimal abreviada (http://2130706433 = 127.0.0.1). El parser de URL
  // normalmente ya la expande; esto es red de seguridad por si algún runtime no.
  if (/^\d+$/.test(host)) {
    const asInt = Number(host);
    if (!Number.isSafeInteger(asInt) || asInt > 0xffffffff) return "invalid";
    return classifyIpv4((asInt >>> 24) & 0xff, (asInt >>> 16) & 0xff);
  }

  return "public";
}

/** `true` si el host NO es de internet pública (loopback, red privada, metadata). */
export function isBlockedHost(hostname: string): boolean {
  return classifyHost(hostname) !== "public";
}

export function isLocalHostClass(hostClass: HostClass): boolean {
  return hostClass === "loopback" || hostClass === "private";
}

export type ParsedTarget =
  | { ok: true; url: URL; hostClass: HostClass }
  | { ok: false; error: string };

/** Valida que la cadena sea una URL http(s) parseable y la clasifica. */
export function parseHttpUrl(rawUrl: string): ParsedTarget {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: "URL inválida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Solo se soportan http y https" };
  }
  const hostClass = classifyHost(url.hostname);
  if (hostClass === "invalid") {
    return { ok: false, error: "Host inválido" };
  }
  return { ok: true, url, hostClass };
}
