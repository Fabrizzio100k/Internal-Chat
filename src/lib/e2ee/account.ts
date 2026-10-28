"use client";

import {
  getLoginModeAction,
  legacyLoginAction,
  loginAction,
  logoutAction,
  registerAction,
  setupKeysAction,
} from "@/lib/actions/auth";
import { getMyKeysAction } from "@/lib/actions/keys";
import {
  deriveAccountSecrets,
  generateIdentity,
  unwrapIdentity,
  wrapIdentity,
  type AccountSecrets,
} from "@/lib/e2ee/crypto";
import { saveIdentity, wipeAllLocalData, wipeLocalSecrets, type StoredIdentity } from "@/lib/e2ee/key-store";
import { getActiveIdentity, setActiveIdentity } from "@/lib/e2ee/session";
import { deleteAccountAction } from "@/lib/actions/account";
import type { MyKeysPayload } from "@/lib/types/e2ee";
import type { AuthActionResult } from "@/lib/types/auth";

/**
 * Cuentas en el navegador. La contraseña NUNCA se envía al servidor (salvo el último
 * login de una cuenta anterior al E2EE): aquí se transforma en `authSecret` (login) y
 * `wrapKey` (cifra las claves privadas), que no se pueden derivar el uno del otro.
 */

const NETWORK_ERROR = "No se pudo conectar. Intenta de nuevo.";

/** Genera un par de identidades nuevo y las envuelve con la contraseña. */
async function createKeyMaterial(secrets: AccountSecrets): Promise<MyKeysPayload> {
  const generated = await generateIdentity();
  const encryptedPrivateKeys = await wrapIdentity(generated.extractable, secrets.wrapKey);
  return {
    ecdhPublicKey: generated.ecdhPublicKey,
    signPublicKey: generated.signPublicKey,
    encryptedPrivateKeys,
  };
}

/**
 * Descifra las claves privadas y las guarda (no extraíbles) en este navegador. Si
 * IndexedDB no está disponible (p. ej. modo privado) las claves viven solo en memoria
 * durante esta pestaña y se pedirá la contraseña al recargar.
 */
async function unlockAndStore(
  userId: string,
  keys: MyKeysPayload,
  wrapKey: CryptoKey,
): Promise<StoredIdentity> {
  const privateKeys = await unwrapIdentity(keys.encryptedPrivateKeys, wrapKey);
  const identity: StoredIdentity = {
    userId,
    ecdhPrivate: privateKeys.ecdhPrivate,
    signPrivate: privateKeys.signPrivate,
    ecdhPublicKey: keys.ecdhPublicKey,
    signPublicKey: keys.signPublicKey,
  };
  try {
    await saveIdentity(identity);
  } catch {
    // Sin almacenamiento persistente: seguimos en memoria.
  }
  return identity;
}

export async function registerAccount(username: string, password: string): Promise<AuthActionResult> {
  try {
    const secrets = await deriveAccountSecrets(username.trim(), password);
    const keys = await createKeyMaterial(secrets);
    const result = await registerAction({
      username: username.trim(),
      authSecret: secrets.authSecret,
      keys,
    });
    if (!result.success || !result.userId) return result;
    await unlockAndStore(result.userId, keys, secrets.wrapKey);
    return { success: true, userId: result.userId };
  } catch {
    return { success: false, error: NETWORK_ERROR };
  }
}

export async function loginAccount(username: string, password: string): Promise<AuthActionResult> {
  try {
    const name = username.trim();
    const mode = await getLoginModeAction(name);
    const secrets = await deriveAccountSecrets(name, password);

    if (mode === "legacy") {
      // Cuenta anterior al E2EE: última vez que la contraseña llega al servidor.
      const legacy = await legacyLoginAction({ username: name, password });
      if (!legacy.success || !legacy.userId) return legacy;
      const keys = await createKeyMaterial(secrets);
      const setup = await setupKeysAction({ authSecret: secrets.authSecret, keys });
      if (!setup.success) return setup;
      await unlockAndStore(legacy.userId, keys, secrets.wrapKey);
      return { success: true, userId: legacy.userId };
    }

    const result = await loginAction({ username: name, authSecret: secrets.authSecret });
    if (!result.success || !result.keys || !result.userId) return result;
    try {
      await unlockAndStore(result.userId, result.keys, secrets.wrapKey);
    } catch {
      return { success: false, error: "No se pudieron abrir tus claves de cifrado." };
    }
    return { success: true, userId: result.userId };
  } catch {
    return { success: false, error: NETWORK_ERROR };
  }
}

/**
 * Sesión viva pero sin claves en este navegador (almacenamiento borrado, otro
 * navegador): se piden de nuevo con la contraseña. Lanza si la contraseña es incorrecta.
 */
export async function unlockWithPassword(
  userId: string,
  username: string,
  password: string,
): Promise<StoredIdentity> {
  const secrets = await deriveAccountSecrets(username, password);
  const keys = await getMyKeysAction();
  if (keys) return unlockAndStore(userId, keys, secrets.wrapKey);

  // Cuenta sin claves todavía: se activan ahora con esta contraseña.
  const fresh = await createKeyMaterial(secrets);
  const setup = await setupKeysAction({ authSecret: secrets.authSecret, keys: fresh });
  if (!setup.success) throw new Error(setup.error ?? "No se pudo activar el cifrado");
  return unlockAndStore(userId, fresh, secrets.wrapKey);
}

/** Cierra sesión y borra claves privadas e índice de búsqueda de este navegador. */
export async function signOut(): Promise<void> {
  setActiveIdentity(null);
  await wipeLocalSecrets();
  await logoutAction();
}

/**
 * Elimina la cuenta y todos sus datos (ver deleteAccountAction). La contraseña se
 * transforma aquí en `authSecret`: el servidor la comprueba sin recibirla. Si el servidor
 * acepta, este navegador también borra claves, índice y claves fijadas de otras personas.
 */
export async function deleteMyAccount(
  password: string,
  confirmation: string,
): Promise<{ success: boolean; error?: string }> {
  const identity = getActiveIdentity();
  if (!identity) return { success: false, error: "Desbloquea tus mensajes primero." };
  try {
    const secrets = await deriveAccountSecrets(identity.username, password);
    const result = await deleteAccountAction({ confirmation, authSecret: secrets.authSecret });
    if (!result.success) return { success: false, error: result.error };
  } catch {
    return { success: false, error: NETWORK_ERROR };
  }
  setActiveIdentity(null);
  await wipeAllLocalData();
  return { success: true };
}
