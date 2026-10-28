/**
 * Primitivas de cifrado de extremo a extremo (E2EE) sobre WebCrypto.
 *
 * Solo depende de `globalThis.crypto.subtle`: funciona igual en el navegador y en
 * Node 20+ (así se prueba con node:test). NUNCA debe importarse desde código de
 * servidor de la app: el servidor jamás debe ver contraseñas, claves privadas ni
 * claves de conversación.
 *
 * Esquema:
 *  - Cada usuario tiene dos pares de claves P-256: ECDH (recibir claves de
 *    conversación) y ECDSA (firmar mensajes y envolturas de claves).
 *  - De la contraseña se derivan en el CLIENTE, con PBKDF2 + HKDF, dos secretos
 *    independientes: `authSecret` (lo único que ve el servidor, para el login) y
 *    `wrapKey` (cifra las claves privadas que se guardan en el servidor). Conocer
 *    uno no permite calcular el otro.
 *  - Cada conversación tiene una clave AES-256-GCM por "época". Se reparte a cada
 *    miembro cifrada con ECIES (ECDH efímero + HKDF + AES-GCM) y firmada por quien
 *    la repartió, para que el servidor no pueda inyectar una clave suya.
 *  - Cada mensaje va cifrado con AES-GCM (con relleno para ocultar la longitud) y
 *    firmado con la clave ECDSA del remitente (autenticidad dentro del grupo).
 *  - Cada archivo se cifra con su propia clave aleatoria, que viaja dentro del
 *    mensaje cifrado.
 */

export const PBKDF2_ITERATIONS = 600_000;

const GCM_IV_BYTES = 12;
const SIGNATURE_BYTES = 64; // ECDSA P-256 en formato IEEE P1363 (r||s)
const EC_RAW_PUBLIC_BYTES = 65; // punto P-256 sin comprimir
const PADDING_BLOCK = 64;
const MAX_PLAINTEXT_BYTES = 256 * 1024;

type Bytes = Uint8Array<ArrayBuffer>;

export class E2eeError extends Error {
  constructor(
    public readonly code:
      | "bad-signature"
      | "bad-ciphertext"
      | "bad-key"
      | "bad-input"
      | "missing-key"
      | "key-changed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "E2eeError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new E2eeError(
      "bad-input",
      "WebCrypto no está disponible (se requiere HTTPS o localhost).",
    );
  }
  return c.subtle;
}

// ---------------------------------------------------------------------------
// Utilidades de bytes / base64
// ---------------------------------------------------------------------------

export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Bytes {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new E2eeError("bad-input", "Base64 inválido");
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Secretos derivados de la contraseña
// ---------------------------------------------------------------------------

export type AccountSecrets = {
  /** Se envía al servidor en lugar de la contraseña (43 caracteres base64url). */
  authSecret: string;
  /** Cifra/descifra las claves privadas guardadas en el servidor. No sale del cliente. */
  wrapKey: CryptoKey;
};

/**
 * PBKDF2-SHA256 (600k iteraciones, sal dependiente del usuario) -> HKDF con dos
 * etiquetas distintas. Como HKDF es unidireccional, el servidor (que ve
 * `authSecret`) no puede calcular `wrapKey`.
 */
export async function deriveAccountSecrets(
  username: string,
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<AccountSecrets> {
  const s = subtle();
  const passwordKey = await s.importKey(
    "raw",
    textEncoder.encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const master = await s.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: textEncoder.encode(`internal-chat/e2ee/v1/${username}`),
      iterations,
    },
    passwordKey,
    256,
  );
  const hkdfKey = await s.importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);
  const empty = new Uint8Array(0);
  const authBits = await s.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: empty, info: textEncoder.encode("auth") },
    hkdfKey,
    256,
  );
  const wrapKey = await s.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: empty, info: textEncoder.encode("wrap") },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { authSecret: toBase64Url(authBits), wrapKey };
}

// ---------------------------------------------------------------------------
// Identidad del usuario (ECDH + ECDSA)
// ---------------------------------------------------------------------------

export type PublicIdentity = {
  /** SPKI en base64. */
  ecdhPublicKey: string;
  /** SPKI en base64. */
  signPublicKey: string;
};

export type PrivateIdentity = {
  ecdhPrivate: CryptoKey;
  signPrivate: CryptoKey;
};

export type GeneratedIdentity = PublicIdentity & {
  /** Extraíbles SOLO para poder envolverlas; luego se reimportan como no extraíbles. */
  extractable: PrivateIdentity;
};

const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" } as const;
const ECDSA_PARAMS = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const IDENTITY_AAD = textEncoder.encode("internal-chat/identity/v1");

export async function generateIdentity(): Promise<GeneratedIdentity> {
  const s = subtle();
  const [ecdh, sign] = await Promise.all([
    s.generateKey(ECDH_PARAMS, true, ["deriveBits"]),
    s.generateKey(ECDSA_PARAMS, true, ["sign", "verify"]),
  ]);
  const [ecdhSpki, signSpki] = await Promise.all([
    s.exportKey("spki", ecdh.publicKey),
    s.exportKey("spki", sign.publicKey),
  ]);
  return {
    ecdhPublicKey: toBase64(ecdhSpki),
    signPublicKey: toBase64(signSpki),
    extractable: { ecdhPrivate: ecdh.privateKey, signPrivate: sign.privateKey },
  };
}

/** Cifra las dos claves privadas con `wrapKey`. Resultado: base64(iv || ciphertext). */
export async function wrapIdentity(
  identity: PrivateIdentity,
  wrapKey: CryptoKey,
): Promise<string> {
  const s = subtle();
  const [ecdh, sign] = await Promise.all([
    s.exportKey("pkcs8", identity.ecdhPrivate),
    s.exportKey("pkcs8", identity.signPrivate),
  ]);
  const json = JSON.stringify({ v: 1, ecdh: toBase64(ecdh), sign: toBase64(sign) });
  const iv = randomBytes(GCM_IV_BYTES);
  const ct = await s.encrypt(
    { name: "AES-GCM", iv, additionalData: IDENTITY_AAD },
    wrapKey,
    textEncoder.encode(json),
  );
  return toBase64(concatBytes(iv, new Uint8Array(ct)));
}

/** Descifra el bloque del servidor y reimporta las claves como NO extraíbles. */
export async function unwrapIdentity(blob: string, wrapKey: CryptoKey): Promise<PrivateIdentity> {
  const s = subtle();
  const data = fromBase64(blob);
  if (data.length <= GCM_IV_BYTES + 16) throw new E2eeError("bad-ciphertext");
  let json: { v: number; ecdh: string; sign: string };
  try {
    const plain = await s.decrypt(
      { name: "AES-GCM", iv: data.subarray(0, GCM_IV_BYTES), additionalData: IDENTITY_AAD },
      wrapKey,
      data.subarray(GCM_IV_BYTES),
    );
    json = JSON.parse(textDecoder.decode(plain));
  } catch {
    // Contraseña incorrecta o bloque corrupto: AES-GCM no autentica.
    throw new E2eeError("bad-key", "No se pudieron descifrar las claves");
  }
  if (json.v !== 1) throw new E2eeError("bad-key", "Versión de claves no soportada");
  const [ecdhPrivate, signPrivate] = await Promise.all([
    s.importKey("pkcs8", fromBase64(json.ecdh), ECDH_PARAMS, false, ["deriveBits"]),
    s.importKey("pkcs8", fromBase64(json.sign), ECDSA_PARAMS, false, ["sign"]),
  ]);
  return { ecdhPrivate, signPrivate };
}

export function importEcdhPublic(spkiBase64: string): Promise<CryptoKey> {
  return subtle().importKey("spki", fromBase64(spkiBase64), ECDH_PARAMS, true, []);
}

export function importSignPublic(spkiBase64: string): Promise<CryptoKey> {
  return subtle().importKey("spki", fromBase64(spkiBase64), ECDSA_PARAMS, true, ["verify"]);
}

export function identitiesEqual(a: PublicIdentity, b: PublicIdentity): boolean {
  return a.ecdhPublicKey === b.ecdhPublicKey && a.signPublicKey === b.signPublicKey;
}

// ---------------------------------------------------------------------------
// Huellas y números de seguridad (verificación fuera de banda)
// ---------------------------------------------------------------------------

async function sha(algorithm: "SHA-256" | "SHA-512", data: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle().digest(algorithm, data));
}

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Huella corta de una identidad, en grupos de 4 hex (p. ej. "9f2a 01bc ..."). */
export async function fingerprint(identity: PublicIdentity): Promise<string> {
  const digest = await sha(
    "SHA-256",
    textEncoder.encode(`${identity.ecdhPublicKey}|${identity.signPublicKey}`),
  );
  return hexOf(digest.subarray(0, 16)).replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Número de seguridad de 60 dígitos entre dos personas, como en Signal. Es
 * simétrico: ambos ven el mismo número. Si coincide al compararlo por otro canal,
 * nadie (ni el servidor) cambió las claves en medio.
 */
export async function safetyNumber(
  a: { userId: string } & PublicIdentity,
  b: { userId: string } & PublicIdentity,
): Promise<string> {
  const parts = [a, b]
    .map((x) => `${x.userId}|${x.ecdhPublicKey}|${x.signPublicKey}`)
    .sort();
  const digest = await sha("SHA-512", textEncoder.encode(`safety:v1|${parts.join("||")}`));
  const view = new DataView(digest.buffer);
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    groups.push(String(view.getUint32(i * 4) % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
}

// ---------------------------------------------------------------------------
// Claves de conversación
// ---------------------------------------------------------------------------

export function generateConversationKeyBytes(): Bytes {
  return randomBytes(32);
}

export function importConversationKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== 32) throw new E2eeError("bad-key", "Longitud de clave inválida");
  return subtle().importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export type WrapContext = {
  conversationId: string;
  epoch: number;
  recipientId: string;
  wrapperId: string;
};

function wrapAadString(ctx: WrapContext): string {
  return `conv-key:v1|${ctx.conversationId}|${ctx.epoch}|${ctx.recipientId}|${ctx.wrapperId}`;
}

async function eciesKey(shared: ArrayBuffer, salt: Bytes): Promise<CryptoKey> {
  const s = subtle();
  const hkdf = await s.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return s.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: textEncoder.encode("conv-key-wrap:v1") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Cifra la clave de conversación para UN destinatario (ECIES) y la firma con la
 * clave de firma de quien la reparte.
 */
export async function wrapConversationKey(
  rawKey: Bytes,
  recipientEcdhPublic: CryptoKey,
  wrapperSignPrivate: CryptoKey,
  ctx: WrapContext,
): Promise<{ wrappedKey: string; signature: string }> {
  const s = subtle();
  const ephemeral = await s.generateKey(ECDH_PARAMS, true, ["deriveBits"]);
  const shared = await s.deriveBits(
    { name: "ECDH", public: recipientEcdhPublic },
    ephemeral.privateKey,
    256,
  );
  const ephemeralRaw = new Uint8Array(await s.exportKey("raw", ephemeral.publicKey));
  const aesKey = await eciesKey(shared, ephemeralRaw);
  const iv = randomBytes(GCM_IV_BYTES);
  const aad = textEncoder.encode(wrapAadString(ctx));
  const ct = await s.encrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, rawKey);
  const wrappedKey = toBase64(concatBytes(ephemeralRaw, iv, new Uint8Array(ct)));
  const signature = await s.sign(
    ECDSA_SIGN,
    wrapperSignPrivate,
    textEncoder.encode(`${wrapAadString(ctx)}|${wrappedKey}`),
  );
  return { wrappedKey, signature: toBase64(signature) };
}

/** Verifica la firma de quien repartió la clave y la descifra con nuestra ECDH privada. */
export async function unwrapConversationKey(
  wrappedKey: string,
  signature: string,
  myEcdhPrivate: CryptoKey,
  wrapperSignPublic: CryptoKey,
  ctx: WrapContext,
): Promise<Bytes> {
  const s = subtle();
  const valid = await s.verify(
    ECDSA_SIGN,
    wrapperSignPublic,
    fromBase64(signature),
    textEncoder.encode(`${wrapAadString(ctx)}|${wrappedKey}`),
  );
  if (!valid) throw new E2eeError("bad-signature", "Firma de la clave de conversación inválida");

  const data = fromBase64(wrappedKey);
  if (data.length < EC_RAW_PUBLIC_BYTES + GCM_IV_BYTES + 16) throw new E2eeError("bad-ciphertext");
  const ephemeralRaw = data.subarray(0, EC_RAW_PUBLIC_BYTES);
  const iv = data.subarray(EC_RAW_PUBLIC_BYTES, EC_RAW_PUBLIC_BYTES + GCM_IV_BYTES);
  const ct = data.subarray(EC_RAW_PUBLIC_BYTES + GCM_IV_BYTES);
  try {
    const ephemeralPublic = await s.importKey("raw", ephemeralRaw, ECDH_PARAMS, false, []);
    const shared = await s.deriveBits({ name: "ECDH", public: ephemeralPublic }, myEcdhPrivate, 256);
    const aesKey = await eciesKey(shared, ephemeralRaw);
    const raw = await s.decrypt(
      { name: "AES-GCM", iv, additionalData: textEncoder.encode(wrapAadString(ctx)) },
      aesKey,
      ct,
    );
    return new Uint8Array(raw);
  } catch {
    throw new E2eeError("bad-ciphertext", "No se pudo descifrar la clave de conversación");
  }
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

export type MessageContext = {
  conversationId: string;
  epoch: number;
  senderId: string;
};

function messageAad(ctx: MessageContext): Bytes {
  return textEncoder.encode(`msg:v1|${ctx.conversationId}|${ctx.epoch}|${ctx.senderId}`);
}

function pad(data: Bytes): Bytes {
  if (data.length > MAX_PLAINTEXT_BYTES) throw new E2eeError("bad-input", "Mensaje demasiado grande");
  const total = Math.ceil((4 + data.length) / PADDING_BLOCK) * PADDING_BLOCK;
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(data, 4);
  return out;
}

function unpad(padded: Bytes): Bytes {
  if (padded.length < 4) throw new E2eeError("bad-ciphertext");
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (length > padded.length - 4) throw new E2eeError("bad-ciphertext");
  return new Uint8Array(padded.subarray(4, 4 + length));
}

/**
 * Cifra y firma el contenido de un mensaje. Formato: base64(iv || ciphertext || firma).
 * La firma cubre el contexto (conversación, época, remitente), el iv y el ciphertext.
 */
export async function encryptMessagePayload(
  key: CryptoKey,
  signPrivate: CryptoKey,
  ctx: MessageContext,
  payload: unknown,
): Promise<string> {
  const s = subtle();
  const aad = messageAad(ctx);
  const iv = randomBytes(GCM_IV_BYTES);
  const ct = new Uint8Array(
    await s.encrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      pad(textEncoder.encode(JSON.stringify(payload))),
    ),
  );
  const body = concatBytes(iv, ct);
  const signature = new Uint8Array(await s.sign(ECDSA_SIGN, signPrivate, concatBytes(aad, body)));
  return toBase64(concatBytes(body, signature));
}

export async function decryptMessagePayload<T>(
  key: CryptoKey,
  senderSignPublic: CryptoKey,
  ctx: MessageContext,
  blob: string,
): Promise<T> {
  const s = subtle();
  const data = fromBase64(blob);
  if (data.length < GCM_IV_BYTES + 16 + SIGNATURE_BYTES) throw new E2eeError("bad-ciphertext");
  const body = data.subarray(0, data.length - SIGNATURE_BYTES);
  const signature = data.subarray(data.length - SIGNATURE_BYTES);
  const aad = messageAad(ctx);
  const valid = await s.verify(ECDSA_SIGN, senderSignPublic, signature, concatBytes(aad, body));
  if (!valid) throw new E2eeError("bad-signature", "Firma del mensaje inválida");
  try {
    const plain = await s.decrypt(
      { name: "AES-GCM", iv: body.subarray(0, GCM_IV_BYTES), additionalData: aad },
      key,
      body.subarray(GCM_IV_BYTES),
    );
    return JSON.parse(textDecoder.decode(unpad(new Uint8Array(plain)))) as T;
  } catch (error) {
    if (error instanceof E2eeError) throw error;
    throw new E2eeError("bad-ciphertext", "No se pudo descifrar el mensaje");
  }
}

// ---------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------

/** Sobrecoste del cifrado de archivos: iv (12) + etiqueta GCM (16). */
export const FILE_OVERHEAD_BYTES = GCM_IV_BYTES + 16;

function fileAad(ref: string): Bytes {
  return textEncoder.encode(`file:v1|${ref}`);
}

/** Cifra un archivo con una clave nueva y aleatoria. `ref` liga el blob a su adjunto. */
export async function encryptFile(
  data: ArrayBuffer,
  ref: string,
): Promise<{ blob: Bytes; key: string }> {
  const s = subtle();
  const rawKey = randomBytes(32);
  const key = await s.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = randomBytes(GCM_IV_BYTES);
  const ct = await s.encrypt({ name: "AES-GCM", iv, additionalData: fileAad(ref) }, key, data);
  return { blob: concatBytes(iv, new Uint8Array(ct)), key: toBase64(rawKey) };
}

export async function decryptFile(
  blob: ArrayBuffer,
  keyBase64: string,
  ref: string,
): Promise<ArrayBuffer> {
  const s = subtle();
  const data = new Uint8Array(blob);
  if (data.length < FILE_OVERHEAD_BYTES) throw new E2eeError("bad-ciphertext");
  const key = await s.importKey("raw", fromBase64(keyBase64), { name: "AES-GCM", length: 256 }, false, [
    "decrypt",
  ]);
  try {
    return await s.decrypt(
      { name: "AES-GCM", iv: data.subarray(0, GCM_IV_BYTES), additionalData: fileAad(ref) },
      key,
      data.subarray(GCM_IV_BYTES),
    );
  } catch {
    throw new E2eeError("bad-ciphertext", "No se pudo descifrar el archivo");
  }
}
