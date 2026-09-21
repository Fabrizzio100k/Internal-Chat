import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Segundos hasta que la ventana actual expire y el contador se reinicie. */
  retryAfterSeconds: number;
};

/**
 * Obtiene la IP real del cliente. En Vercel (y la mayoría de proxies), la
 * IP real del cliente viaja en el header `x-forwarded-for` (el primer valor
 * de la lista, ya que puede haber múltiples proxies intermedios). Sin leer
 * ese header, Server Actions/Route Handlers solo ven la IP interna del
 * proxy de la plataforma, no la del usuario real.
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = headersList.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  // Fallback para entornos sin proxy (desarrollo local sin header).
  return "unknown";
}

/**
 * Verifica y registra un intento contra el rate limit de `endpoint` para
 * la IP actual, usando una tabla en Postgres (sin Redis ni infraestructura
 * adicional). Implementa ventana fija (fixed window): cada `windowMs` el
 * contador se reinicia a 1; dentro de la misma ventana se incrementa.
 *
 * El upsert es atómico (INSERT ... ON CONFLICT ... DO UPDATE) para evitar
 * race conditions si llegan requests concurrentes de la misma IP.
 */
export async function checkRateLimit(
  endpoint: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const ip = await getClientIp();
  const key = `${ip}:${endpoint}`;
  const now = new Date();
  const windowSeconds = Math.ceil(windowMs / 1000);

  // Upsert atómico: si la fila no existe, la crea con count=1. Si existe,
  // decide en el propio UPDATE (con CASE) si debe resetear la ventana
  // (cuando ya expiró) o incrementar el contador dentro de la ventana actual.
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "rate_limits" ("key", "count", "windowStart", "updatedAt")
    VALUES (${key}, 1, ${now}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limits"."windowStart" <= ${now}::timestamp - (${windowSeconds}::text || ' seconds')::interval
          THEN 1
        ELSE "rate_limits"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "rate_limits"."windowStart" <= ${now}::timestamp - (${windowSeconds}::text || ' seconds')::interval
          THEN ${now}
        ELSE "rate_limits"."windowStart"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "windowStart";
  `;

  const result = rows[0];
  const elapsedMs = now.getTime() - new Date(result.windowStart).getTime();
  const retryAfterSeconds = Math.max(0, Math.ceil((windowMs - elapsedMs) / 1000));

  return {
    allowed: result.count <= limit,
    remaining: Math.max(0, limit - result.count),
    limit,
    retryAfterSeconds,
  };
}
