"use client";

import {
  getKeyBundleAction,
  getPublicKeysAction,
  initConversationKeysAction,
  rotateConversationKeysAction,
} from "@/lib/actions/keys";
import {
  E2eeError,
  fingerprint,
  generateConversationKeyBytes,
  importConversationKey,
  importEcdhPublic,
  importSignPublic,
  safetyNumber,
  unwrapConversationKey,
  wrapConversationKey,
} from "@/lib/e2ee/crypto";
import { getPin, setPin } from "@/lib/e2ee/key-store";
import { onIdentityReset, requireIdentity } from "@/lib/e2ee/session";
import type { KeyBundle, KeyEpochUpdate, PublicKeyInfo } from "@/lib/types/e2ee";

/**
 * Claves de conversación en el navegador: carga las envolturas propias, verifica
 * firmas, fija (TOFU) las claves públicas de cada persona y reparte claves nuevas
 * al crear la conversación o cambiar la membresía.
 */

/** La clave pública de alguien cambió respecto a la que vimos antes (posible MITM). */
export class KeyChangedError extends E2eeError {
  constructor(
    public readonly userId: string,
    public readonly username: string,
  ) {
    super("key-changed", `Cambió la clave de cifrado de ${username}`);
    this.name = "KeyChangedError";
  }
}

/** Hay miembros que todavía no activaron el cifrado (nunca iniciaron sesión tras la actualización). */
export class MissingKeysError extends Error {
  constructor(public readonly usernames: string[]) {
    super(`${usernames.join(", ")} aún no activó el cifrado. Debe iniciar sesión una vez.`);
    this.name = "MissingKeysError";
  }
}

export type ConversationState = {
  bundle: KeyBundle;
  /** Claves de conversación que pude abrir, por época. */
  epochKeys: Map<number, CryptoKey>;
  /** Claves de verificación (ECDSA pública) por usuario. */
  signKeys: Map<string, CryptoKey>;
  usernames: Map<string, string>;
};

const states = new Map<string, Promise<ConversationState>>();
const FAILURE_CACHE_MS = 3000;
onIdentityReset(() => states.clear());

export function invalidateConversation(conversationId: string): void {
  states.delete(conversationId);
}

function hasKeys(info: PublicKeyInfo): info is PublicKeyInfo & {
  ecdhPublicKey: string;
  signPublicKey: string;
} {
  return Boolean(info.ecdhPublicKey && info.signPublicKey);
}

/** Fija las claves de cada persona la primera vez y falla si después cambian. */
async function verifyAndPin(infos: PublicKeyInfo[]): Promise<void> {
  const me = requireIdentity();
  for (const info of infos) {
    if (!hasKeys(info)) continue;
    if (info.userId === me.userId) {
      // El servidor no puede cambiar MIS claves públicas sin que me entere.
      if (info.ecdhPublicKey !== me.ecdhPublicKey || info.signPublicKey !== me.signPublicKey) {
        throw new KeyChangedError(info.userId, info.username);
      }
      continue;
    }
    const pin = await getPin(me.userId, info.userId);
    if (!pin) {
      await setPin(me.userId, info.userId, info);
    } else if (
      pin.ecdhPublicKey !== info.ecdhPublicKey ||
      pin.signPublicKey !== info.signPublicKey
    ) {
      throw new KeyChangedError(info.userId, info.username);
    }
  }
}

async function loadState(conversationId: string): Promise<ConversationState> {
  const me = requireIdentity();
  const bundle = await getKeyBundleAction(conversationId);
  if (!bundle) throw new E2eeError("bad-input", "Conversación no encontrada");

  const people = [...bundle.members, ...bundle.signers];
  await verifyAndPin(people);

  const signKeys = new Map<string, CryptoKey>();
  const usernames = new Map<string, string>();
  for (const person of people) {
    usernames.set(person.userId, person.username);
    if (hasKeys(person)) signKeys.set(person.userId, await importSignPublic(person.signPublicKey));
  }

  const epochKeys = new Map<number, CryptoKey>();
  for (const entry of bundle.myKeys) {
    const wrapperKey = signKeys.get(entry.wrappedById);
    if (!wrapperKey) continue;
    try {
      const raw = await unwrapConversationKey(
        entry.wrappedKey,
        entry.signature,
        me.ecdhPrivate,
        wrapperKey,
        {
          conversationId,
          epoch: entry.epoch,
          recipientId: me.userId,
          wrapperId: entry.wrappedById,
        },
      );
      epochKeys.set(entry.epoch, await importConversationKey(raw));
    } catch {
      // Envoltura inválida (firma falsa o corrupta): esa época queda inaccesible.
    }
  }

  return { bundle, epochKeys, signKeys, usernames };
}

export function getConversationState(conversationId: string): Promise<ConversationState> {
  let pending = states.get(conversationId);
  if (!pending) {
    pending = loadState(conversationId);
    states.set(conversationId, pending);
    const failed = pending;
    // Un fallo se conserva unos segundos: así 50 mensajes descifrándose a la vez no
    // disparan 50 peticiones al servidor mientras el problema persiste.
    failed.catch(() =>
      setTimeout(() => {
        if (states.get(conversationId) === failed) states.delete(conversationId);
      }, FAILURE_CACHE_MS),
    );
  }
  return pending;
}

const lastRefresh = new Map<string, number>();
const REFRESH_THROTTLE_MS = 5000;

/**
 * Como getConversationState, pero vuelve a pedir el bundle al servidor (como mucho
 * una vez cada 5 s por conversación). Se usa cuando llega algo más nuevo que lo que
 * tenemos en caché: una época o un remitente que aún no conocíamos.
 */
export function getFreshState(conversationId: string): Promise<ConversationState> {
  const now = Date.now();
  if (now - (lastRefresh.get(conversationId) ?? 0) >= REFRESH_THROTTLE_MS) {
    lastRefresh.set(conversationId, now);
    invalidateConversation(conversationId);
  }
  return getConversationState(conversationId);
}

async function buildEpochUpdate(
  conversationId: string,
  epoch: number,
  members: PublicKeyInfo[],
): Promise<KeyEpochUpdate> {
  const me = requireIdentity();
  const missing = members.filter((m) => !hasKeys(m));
  if (missing.length > 0) throw new MissingKeysError(missing.map((m) => m.username));

  const raw = generateConversationKeyBytes();
  const keys = [];
  for (const member of members) {
    if (!hasKeys(member)) continue;
    const wrapped = await wrapConversationKey(
      raw,
      await importEcdhPublic(member.ecdhPublicKey),
      me.signPrivate,
      { conversationId, epoch, recipientId: member.userId, wrapperId: me.userId },
    );
    keys.push({ userId: member.userId, ...wrapped });
  }
  return { epoch, keys };
}

/**
 * Devuelve la clave con la que cifrar ahora. Si la conversación aún no tiene clave
 * (o quedó pendiente de renovar tras la salida de alguien) la crea y reparte antes.
 */
export async function getSendingKey(
  conversationId: string,
): Promise<{ epoch: number; key: CryptoKey; state: ConversationState }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await getConversationState(conversationId);
    const { bundle } = state;

    if (bundle.currentEpoch === 0 || bundle.rotationPending) {
      const update = await buildEpochUpdate(
        conversationId,
        bundle.currentEpoch + 1,
        bundle.members,
      );
      const result =
        bundle.currentEpoch === 0
          ? await initConversationKeysAction(conversationId, update.keys)
          : await rotateConversationKeysAction(conversationId, update);
      invalidateConversation(conversationId);
      if (!result.success && !result.stale) {
        if (result.missingKeys?.length) throw new MissingKeysError(result.missingKeys);
        throw new E2eeError("bad-input", result.error ?? "No se pudo crear la clave");
      }
      continue; // recarga el estado con la clave ya repartida (o la que ganó la carrera)
    }

    const key = state.epochKeys.get(bundle.currentEpoch);
    if (!key) throw new E2eeError("missing-key", "No tienes la clave actual de esta conversación");
    return { epoch: bundle.currentEpoch, key, state };
  }
  throw new E2eeError("bad-input", "No se pudo preparar el cifrado. Reintenta.");
}

/**
 * Época nueva para un cambio de membresía en un grupo (alta o baja). La reparte el
 * admin: los miembros resultantes reciben la clave nueva y nadie más.
 */
export async function buildGroupKeyUpdate(
  conversationId: string,
  change: { add?: string[]; remove?: string },
): Promise<KeyEpochUpdate> {
  invalidateConversation(conversationId); // partir del estado más reciente del servidor
  const { bundle } = await getConversationState(conversationId);
  let members = bundle.members;

  if (change.add?.length) {
    const added = await getPublicKeysAction(change.add);
    await verifyAndPin(added);
    members = [...members, ...added.filter((a) => !members.some((m) => m.userId === a.userId))];
  }
  if (change.remove) members = members.filter((m) => m.userId !== change.remove);

  return buildEpochUpdate(conversationId, bundle.currentEpoch + 1, members);
}

// ---------------------------------------------------------------------------
// Verificación de identidades (número de seguridad)
// ---------------------------------------------------------------------------

export type PersonVerification = {
  userId: string;
  username: string;
  hasKeys: boolean;
  fingerprint: string | null;
  /** Solo en chats 1:1 y para el resto de miembros: número de seguridad compartido. */
  safetyNumber: string | null;
  /** El número fue comparado por otro canal. */
  verified: boolean;
  /** La clave actual NO coincide con la que se fijó antes: no confiar hasta revisar. */
  changed: boolean;
};

export async function loadVerification(conversationId: string): Promise<PersonVerification[]> {
  const me = requireIdentity();
  const bundle = await getKeyBundleAction(conversationId);
  if (!bundle) return [];

  const result: PersonVerification[] = [];
  for (const member of bundle.members) {
    if (member.userId === me.userId) continue;
    if (!hasKeys(member)) {
      result.push({
        userId: member.userId,
        username: member.username,
        hasKeys: false,
        fingerprint: null,
        safetyNumber: null,
        verified: false,
        changed: false,
      });
      continue;
    }
    const pin = await getPin(me.userId, member.userId);
    result.push({
      userId: member.userId,
      username: member.username,
      hasKeys: true,
      fingerprint: await fingerprint(member),
      safetyNumber: await safetyNumber(
        { userId: me.userId, ecdhPublicKey: me.ecdhPublicKey, signPublicKey: me.signPublicKey },
        member,
      ),
      verified: Boolean(pin?.verified) && !isChanged(pin, member),
      changed: isChanged(pin, member),
    });
  }
  return result;
}

function isChanged(
  pin: { ecdhPublicKey: string; signPublicKey: string } | null,
  member: { ecdhPublicKey: string; signPublicKey: string },
): boolean {
  return Boolean(
    pin && (pin.ecdhPublicKey !== member.ecdhPublicKey || pin.signPublicKey !== member.signPublicKey),
  );
}

/** El usuario revisó el número de seguridad y acepta la clave actual de esa persona. */
export async function trustCurrentKey(
  conversationId: string,
  userId: string,
  verified: boolean,
): Promise<void> {
  const me = requireIdentity();
  const bundle = await getKeyBundleAction(conversationId);
  const person = [...(bundle?.members ?? []), ...(bundle?.signers ?? [])].find(
    (p) => p.userId === userId,
  );
  if (!person || !hasKeys(person)) throw new E2eeError("bad-input", "Esa persona no tiene claves");
  await setPin(me.userId, userId, person, verified);
  invalidateConversation(conversationId);
}
