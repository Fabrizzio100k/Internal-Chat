// Tipos compartidos entre cliente y servidor para las claves E2EE.
// El servidor solo maneja claves públicas y datos ya cifrados en el navegador.

/** Clave de conversación cifrada para un miembro, tal como la guarda el servidor. */
export type WrappedKeyEntry = {
  userId: string;
  wrappedKey: string;
  signature: string;
};

/** Claves de un usuario que ve el resto (públicas). null = aún no activó el cifrado. */
export type PublicKeyInfo = {
  userId: string;
  username: string;
  ecdhPublicKey: string | null;
  signPublicKey: string | null;
};

/** Mis claves guardadas en el servidor (la privada viene cifrada con mi contraseña). */
export type MyKeysPayload = {
  ecdhPublicKey: string;
  signPublicKey: string;
  encryptedPrivateKeys: string;
};

/** Una entrada de clave de conversación que me corresponde. */
export type MyConversationKey = {
  epoch: number;
  wrappedKey: string;
  signature: string;
  wrappedById: string;
};

/** Todo lo que el cliente necesita para cifrar/descifrar en una conversación. */
export type KeyBundle = {
  conversationId: string;
  isGroup: boolean;
  currentEpoch: number;
  rotationPending: boolean;
  isAdmin: boolean;
  /** Miembros actuales con sus claves públicas. */
  members: PublicKeyInfo[];
  /** Claves públicas de quienes firmaron envolturas o mensajes (pueden haber salido). */
  signers: PublicKeyInfo[];
  /** Mis envolturas, de todas las épocas a las que tuve acceso. */
  myKeys: MyConversationKey[];
};

export type KeyActionResult = {
  success: boolean;
  error?: string;
  /** La época cambió mientras tanto: el cliente debe refrescar y reintentar. */
  stale?: boolean;
  /** Miembros que todavía no activaron el cifrado (no tienen claves públicas). */
  missingKeys?: string[];
};

/** Datos que el cliente manda al servidor al cambiar de época. */
export type KeyEpochUpdate = {
  epoch: number;
  keys: WrappedKeyEntry[];
};
