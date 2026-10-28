import type { MyKeysPayload } from "@/lib/types/e2ee";

export type AuthActionResult = {
  success: boolean;
  error?: string;
  userId?: string;
  /** Claves del usuario (la privada cifrada con su contraseña), para desbloquear en el navegador. */
  keys?: MyKeysPayload;
  /** Cuenta anterior al E2EE: el cliente debe generar claves y llamar a setupKeysAction. */
  needsKeySetup?: boolean;
};

export type LoginMode = "e2ee" | "legacy";
