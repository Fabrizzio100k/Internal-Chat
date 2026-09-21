import { createClient } from "@supabase/supabase-js";

export type EdgeRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Rate limiting global por IP, compatible con Edge Runtime (usado desde
 * src/proxy.ts). Prisma Client no funciona en Edge Runtime, así que en vez
 * de $queryRaw se usa @supabase/supabase-js con la REST API de Supabase
 * (PostgREST), que sí es compatible con Edge, contra la misma tabla
 * "rate_limits" que usa el rate limiting de las Server Actions/Route Handlers.
 *
 * Nota: esto hace un roundtrip HTTP a Supabase en cada request que matchee
 * el proxy, lo cual añade latencia. Se usa una ventana amplia y un límite
 * generoso pensado como red de seguridad general (no reemplaza los límites
 * específicos y más estrictos de cada endpoint sensible).
 */
export async function checkEdgeRateLimit(
  ip: string,
  endpoint: string,
  limit: number,
  windowMs: number,
): Promise<EdgeRateLimitResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    // Si falta configuración, no bloqueamos tráfico por un error nuestro;
    // dejamos pasar la request (fail-open) y confiamos en los límites
    // específicos de cada endpoint como respaldo.
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const key = `${ip}:${endpoint}`;
  const now = new Date();
  const windowSeconds = Math.ceil(windowMs / 1000);

  try {
    const { data, error } = await supabase.rpc("upsert_rate_limit", {
      p_key: key,
      p_window_seconds: windowSeconds,
    });

    if (error || !data) {
      // Si la función RPC falla (p. ej. no se ha creado aún), fail-open.
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const result = Array.isArray(data) ? data[0] : data;
    const count = result.count as number;
    const windowStart = new Date(result.window_start as string);
    const elapsedMs = now.getTime() - windowStart.getTime();
    const retryAfterSeconds = Math.max(0, Math.ceil((windowMs - elapsedMs) / 1000));

    return {
      allowed: count <= limit,
      retryAfterSeconds,
    };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
