"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, deleteSession, forgetSessionValidation, getSession } from "@/lib/auth";
import { APP_VERSION } from "@/lib/version";
import {
  registerRequestSchema,
  loginRequestSchema,
  legacyLoginRequestSchema,
  setupKeysRequestSchema,
  usernameSchema,
} from "@/lib/validations/auth";
import type { AuthActionResult, LoginMode } from "@/lib/types/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const BCRYPT_ROUNDS = 12;

// Fuerza bruta: máximo 5 intentos cada 15 minutos por IP, para login y registro.
const AUTH_RATE_LIMIT = 5;
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;

// Consulta del modo de login (e2ee/legacy): algo más holgado, no verifica credenciales.
const LOGIN_MODE_RATE_LIMIT = 20;

const INVALID_CREDENTIALS = "Usuario o contraseña incorrectos";

let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("dummy-credential", BCRYPT_ROUNDS);
  return dummyHash;
}

async function authRateLimit(bucket: string, limit = AUTH_RATE_LIMIT): Promise<string | null> {
  const rateLimit = await checkRateLimit(bucket, limit, AUTH_RATE_WINDOW_MS);
  if (rateLimit.allowed) return null;
  return `Demasiados intentos. Intenta de nuevo en ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minuto(s).`;
}

/**
 * Registro E2EE. El navegador deriva `authSecret` de la contraseña y genera las
 * claves; el servidor guarda un bcrypt de `authSecret` (no de la contraseña),
 * las claves públicas y las privadas ya cifradas. Nunca ve la contraseña.
 */
export async function registerAction(input: unknown): Promise<AuthActionResult> {
  const limited = await authRateLimit("register");
  if (limited) return { success: false, error: limited };

  const parsed = registerRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const { username, authSecret, keys } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return { success: false, error: "Ese nombre de usuario ya está en uso" };
  }

  const passwordHash = await bcrypt.hash(authSecret, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { username, passwordHash, key: { create: keys }, lastSeenVersion: APP_VERSION },
  });

  await createSession({ userId: user.id, username: user.username });
  return { success: true, userId: user.id };
}

/**
 * Dice si la cuenta ya usa E2EE o es anterior (login clásico una última vez, para
 * poder generar sus claves). Usuarios inexistentes se reportan como "e2ee" para no
 * revelar más de lo imprescindible; el intento fallará con el error genérico.
 */
export async function getLoginModeAction(username: string): Promise<LoginMode> {
  const limited = await authRateLimit("login-mode", LOGIN_MODE_RATE_LIMIT);
  if (limited) return "e2ee";

  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) return "e2ee";
  const user = await prisma.user.findUnique({
    where: { username: parsed.data },
    select: { key: { select: { userId: true } } },
  });
  return user && !user.key ? "legacy" : "e2ee";
}

/** Login E2EE: el navegador manda `authSecret`; si coincide devuelve las claves cifradas. */
export async function loginAction(input: unknown): Promise<AuthActionResult> {
  const limited = await authRateLimit("login");
  if (limited) return { success: false, error: limited };

  const parsed = loginRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: INVALID_CREDENTIALS };
  const { username, authSecret } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { username },
    include: { key: true },
  });
  // Comparación aunque no exista el usuario, para no filtrar por tiempo de respuesta.
  const hash = user?.passwordHash ?? (await getDummyHash());
  const matches = await bcrypt.compare(authSecret, hash);
  if (!user || !user.key || !matches) {
    return { success: false, error: INVALID_CREDENTIALS };
  }

  await createSession({ userId: user.id, username: user.username });
  return {
    success: true,
    userId: user.id,
    keys: {
      ecdhPublicKey: user.key.ecdhPublicKey,
      signPublicKey: user.key.signPublicKey,
      encryptedPrivateKeys: user.key.encryptedPrivateKeys,
    },
  };
}

/**
 * Login de cuentas ANTERIORES al E2EE (sin claves). Es la última vez que la
 * contraseña viaja al servidor: acto seguido el cliente genera sus claves y llama
 * a setupKeysAction, que reemplaza el hash de la contraseña por el de `authSecret`.
 * Si la cuenta ya tiene claves, este camino está cerrado (evita degradar el login).
 */
export async function legacyLoginAction(input: unknown): Promise<AuthActionResult> {
  const limited = await authRateLimit("login");
  if (limited) return { success: false, error: limited };

  const parsed = legacyLoginRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: INVALID_CREDENTIALS };
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { username },
    include: { key: { select: { userId: true } } },
  });
  if (!user || user.key) return { success: false, error: INVALID_CREDENTIALS };

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) return { success: false, error: INVALID_CREDENTIALS };

  await createSession({ userId: user.id, username: user.username });
  return { success: true, userId: user.id, needsKeySetup: true };
}

/** Activa el E2EE en una cuenta anterior: guarda sus claves y reemplaza el hash. */
export async function setupKeysAction(input: unknown): Promise<AuthActionResult> {
  const session = await getSession();
  if (!session) return { success: false, error: "No autenticado" };

  const parsed = setupKeysRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const { authSecret, keys } = parsed.data;

  const existing = await prisma.userKey.findUnique({ where: { userId: session.userId } });
  if (existing) return { success: false, error: "Esta cuenta ya tiene el cifrado activado" };

  const passwordHash = await bcrypt.hash(authSecret, BCRYPT_ROUNDS);
  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: session.userId }, data: { passwordHash } }),
      prisma.userKey.create({ data: { userId: session.userId, ...keys } }),
    ]);
  } catch {
    // Carrera: otra pestaña activó el cifrado primero.
    return { success: false, error: "Esta cuenta ya tiene el cifrado activado" };
  }
  return { success: true };
}

export async function logoutAction() {
  const session = await getSession().catch(() => null);
  if (session) {
    await prisma.userSession
      .updateMany({
        where: { id: session.sessionId, userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
    forgetSessionValidation(session.sessionId);
  }
  await deleteSession();
}
