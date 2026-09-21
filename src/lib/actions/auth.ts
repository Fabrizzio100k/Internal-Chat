"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, deleteSession } from "@/lib/auth";
import { registerSchema, loginSchema } from "@/lib/validations/auth";
import type { AuthActionResult } from "@/lib/types/auth";

const BCRYPT_ROUNDS = 12;

export async function registerAction(
  _prevState: AuthActionResult | undefined,
  formData: FormData,
): Promise<AuthActionResult> {
  const parsed = registerSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { username, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return { success: false, error: "Ese nombre de usuario ya está en uso" };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: { username, passwordHash },
  });

  await createSession({ userId: user.id, username: user.username });

  return { success: true };
}

export async function loginAction(
  _prevState: AuthActionResult | undefined,
  formData: FormData,
): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return { success: false, error: "Usuario o contraseña incorrectos" };
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return { success: false, error: "Usuario o contraseña incorrectos" };
  }

  await createSession({ userId: user.id, username: user.username });

  return { success: true };
}

export async function logoutAction() {
  await deleteSession();
}
