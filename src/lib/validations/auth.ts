import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "El usuario debe tener al menos 3 caracteres")
  .max(20, "El usuario debe tener máximo 20 caracteres")
  .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y guion bajo");

export const passwordSchema = z
  .string()
  .min(6, "La contraseña debe tener al menos 6 caracteres")
  .max(72, "La contraseña debe tener máximo 72 caracteres");

// Validación del FORMULARIO (en el navegador): ahí sí existe la contraseña.
export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Ingresa tu usuario"),
  password: z.string().min(1, "Ingresa tu contraseña"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Validación en el SERVIDOR. Con E2EE el servidor nunca recibe la contraseña:
// recibe `authSecret`, un secreto derivado de ella en el navegador (ver
// lib/e2ee/crypto.ts), y las claves públicas + privadas ya cifradas.
// ---------------------------------------------------------------------------

const base64 = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Formato de clave inválido");

export const authSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Credencial inválida");

export const keyMaterialSchema = z.object({
  ecdhPublicKey: base64(200),
  signPublicKey: base64(200),
  encryptedPrivateKeys: base64(4000),
});

export const registerRequestSchema = z.object({
  username: usernameSchema,
  authSecret: authSecretSchema,
  keys: keyMaterialSchema,
});

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  authSecret: authSecretSchema,
});

export const legacyLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

export const setupKeysRequestSchema = z.object({
  authSecret: authSecretSchema,
  keys: keyMaterialSchema,
});
