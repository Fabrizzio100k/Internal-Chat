import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseUserAgent } from "@/lib/device";
import { SESSION_COOKIE_NAME } from "@/lib/session-constants";

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 días

/** Cuánto se confía en una comprobación de sesión contra la BD antes de repetirla. */
const VALIDATION_TTL_MS = 15_000;
/** Cada cuánto se actualiza "visto por última vez" (evita una escritura por petición). */
const TOUCH_INTERVAL_MS = 5 * 60_000;
/** Filas viejas (expiradas/revocadas) se limpian al iniciar sesión. */
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 5000;

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET no está definido en las variables de entorno");
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  userId: string;
  username: string;
  /** Id de la fila UserSession de este dispositivo. */
  sessionId: string;
};

// Caché por instancia del resultado de validar `sid` en la BD. Una revocación tarda como
// máximo VALIDATION_TTL_MS en notarse en las demás instancias (en la propia es inmediata).
const validationCache = new Map<string, { valid: boolean; until: number }>();

function remember(sessionId: string, valid: boolean): void {
  if (validationCache.size >= MAX_CACHE_ENTRIES) validationCache.clear();
  validationCache.set(sessionId, { valid, until: Date.now() + VALIDATION_TTL_MS });
}

/** Olvida la validación guardada (tras revocar una sesión en esta instancia). */
export function forgetSessionValidation(sessionId: string): void {
  validationCache.delete(sessionId);
}

function clientIp(h: Headers): string | null {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || h.get("x-real-ip") || null)?.slice(0, 64) ?? null;
}

/** Crea la fila del dispositivo y fija la cookie. Cada inicio de sesión = un dispositivo. */
export async function createSession(user: { userId: string; username: string }) {
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_DURATION_SECONDS * 1000);

  const requestHeaders = await headers();
  const device = parseUserAgent(requestHeaders.get("user-agent"));

  const row = await prisma.userSession.create({
    data: {
      userId: user.userId,
      deviceName: device.name,
      deviceType: device.type,
      ip: clientIp(requestHeaders),
      expiresAt,
    },
    select: { id: true },
  });

  // Limpieza oportunista: no merece un cron para unas pocas filas por usuario.
  prisma.userSession
    .deleteMany({
      where: {
        userId: user.userId,
        OR: [
          { expiresAt: { lt: new Date(now) } },
          { revokedAt: { lt: new Date(now - PRUNE_AFTER_MS) } },
        ],
      },
    })
    .catch(() => {});

  const token = await new SignJWT({ userId: user.userId, username: user.username, sid: row.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  remember(row.id, true);
}

async function isSessionActive(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const cached = validationCache.get(sessionId);
  if (cached && cached.until > Date.now()) return cached.valid;

  const row = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true, lastSeenAt: true },
  });
  const valid =
    row !== null &&
    row.userId === userId &&
    row.revokedAt === null &&
    row.expiresAt.getTime() > Date.now();
  remember(sessionId, valid);

  if (valid && Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const touch = () =>
      prisma.userSession
        .update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
        .catch(() => {});
    try {
      after(touch);
    } catch {
      void touch(); // fuera de un contexto de petición (no debería ocurrir)
    }
  }
  return valid;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, getSecretKey()));
  } catch {
    return null; // firma inválida o expirada
  }

  const userId = payload.userId;
  const sessionId = payload.sid;
  // Cookies anteriores a las sesiones por dispositivo (sin sid): hay que volver a entrar.
  if (typeof sessionId !== "string" || typeof userId !== "string") return null;
  // Un fallo de BD aquí se propaga a propósito: no debe parecer un cierre de sesión.
  if (!(await isSessionActive(sessionId, userId))) return null;
  return { userId, username: payload.username as string, sessionId };
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export { SESSION_COOKIE_NAME };
