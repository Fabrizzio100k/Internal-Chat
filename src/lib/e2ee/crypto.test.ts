import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  E2eeError,
  decryptFile,
  decryptMessagePayload,
  deriveAccountSecrets,
  encryptFile,
  encryptMessagePayload,
  fingerprint,
  generateConversationKeyBytes,
  generateIdentity,
  importConversationKey,
  importEcdhPublic,
  importSignPublic,
  safetyNumber,
  unwrapConversationKey,
  unwrapIdentity,
  wrapConversationKey,
  wrapIdentity,
} from "./crypto";

// Pocas iteraciones: solo importa la lógica, no el coste de PBKDF2.
const FAST = 1000;

async function expectCode(promise: Promise<unknown>, code: E2eeError["code"]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof E2eeError, `se esperaba E2eeError, llegó ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

describe("secretos de la cuenta", () => {
  it("es determinista y separa authSecret de wrapKey", async () => {
    const a = await deriveAccountSecrets("ana", "correcta-horse", FAST);
    const b = await deriveAccountSecrets("ana", "correcta-horse", FAST);
    assert.equal(a.authSecret, b.authSecret);
    assert.match(a.authSecret, /^[A-Za-z0-9_-]{43}$/);

    const otherUser = await deriveAccountSecrets("beto", "correcta-horse", FAST);
    const otherPass = await deriveAccountSecrets("ana", "otra-clave-123", FAST);
    assert.notEqual(a.authSecret, otherUser.authSecret);
    assert.notEqual(a.authSecret, otherPass.authSecret);
  });

  it("el authSecret no permite abrir las claves privadas", async () => {
    const secrets = await deriveAccountSecrets("ana", "correcta-horse", FAST);
    const identity = await generateIdentity();
    const blob = await wrapIdentity(identity.extractable, secrets.wrapKey);
    // Un atacante que solo conoce authSecret lo usaría como material; no puede derivar wrapKey.
    const wrong = await deriveAccountSecrets("ana", secrets.authSecret, FAST);
    await expectCode(unwrapIdentity(blob, wrong.wrapKey), "bad-key");
  });
});

describe("identidad", () => {
  it("envuelve y desenvuelve las claves privadas; quedan no extraíbles", async () => {
    const secrets = await deriveAccountSecrets("ana", "correcta-horse", FAST);
    const identity = await generateIdentity();
    const blob = await wrapIdentity(identity.extractable, secrets.wrapKey);
    const restored = await unwrapIdentity(blob, secrets.wrapKey);
    assert.equal(restored.ecdhPrivate.extractable, false);
    assert.equal(restored.signPrivate.extractable, false);
  });

  it("rechaza una contraseña incorrecta y un bloque manipulado", async () => {
    const good = await deriveAccountSecrets("ana", "correcta-horse", FAST);
    const bad = await deriveAccountSecrets("ana", "incorrecta-123", FAST);
    const identity = await generateIdentity();
    const blob = await wrapIdentity(identity.extractable, good.wrapKey);
    await expectCode(unwrapIdentity(blob, bad.wrapKey), "bad-key");

    const tampered = Buffer.from(blob, "base64");
    tampered[tampered.length - 1] ^= 1;
    await expectCode(unwrapIdentity(tampered.toString("base64"), good.wrapKey), "bad-key");
  });

  it("el número de seguridad es simétrico y cambia si cambia una clave", async () => {
    const a = { userId: "u1", ...(await generateIdentity()) };
    const b = { userId: "u2", ...(await generateIdentity()) };
    const c = { userId: "u2", ...(await generateIdentity()) };
    const ab = await safetyNumber(a, b);
    assert.equal(ab, await safetyNumber(b, a));
    assert.match(ab, /^(\d{5} ){11}\d{5}$/);
    assert.notEqual(ab, await safetyNumber(a, c));
    assert.match(await fingerprint(a), /^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
  });
});

describe("claves de conversación", () => {
  it("chat contigo mismo: remitente y destinatario son la misma persona", async () => {
    const me = await generateIdentity();
    const raw = generateConversationKeyBytes();
    const ctx = { conversationId: "self", epoch: 1, recipientId: "yo", wrapperId: "yo" };
    const wrapped = await wrapConversationKey(
      raw,
      await importEcdhPublic(me.ecdhPublicKey),
      me.extractable.signPrivate,
      ctx,
    );
    const out = await unwrapConversationKey(
      wrapped.wrappedKey,
      wrapped.signature,
      me.extractable.ecdhPrivate,
      await importSignPublic(me.signPublicKey),
      ctx,
    );
    assert.deepEqual(out, raw);
  });

  async function setup() {
    const alice = await generateIdentity();
    const bob = await generateIdentity();
    const raw = generateConversationKeyBytes();
    const ctx = { conversationId: "c1", epoch: 1, recipientId: "bob", wrapperId: "alice" };
    const wrapped = await wrapConversationKey(
      raw,
      await importEcdhPublic(bob.ecdhPublicKey),
      alice.extractable.signPrivate,
      ctx,
    );
    return { alice, bob, raw, ctx, wrapped };
  }

  it("el destinatario recupera la clave y verifica la firma", async () => {
    const { alice, bob, raw, ctx, wrapped } = await setup();
    const bobPrivate = await unwrapIdentity(
      await wrapIdentity(bob.extractable, (await deriveAccountSecrets("bob", "pw-bob-123", FAST)).wrapKey),
      (await deriveAccountSecrets("bob", "pw-bob-123", FAST)).wrapKey,
    );
    const out = await unwrapConversationKey(
      wrapped.wrappedKey,
      wrapped.signature,
      bobPrivate.ecdhPrivate,
      await importSignPublic(alice.signPublicKey),
      ctx,
    );
    assert.deepEqual(out, raw);
  });

  it("rechaza una firma ajena (servidor que inyecta su propia clave)", async () => {
    const { bob, ctx, wrapped } = await setup();
    const mallory = await generateIdentity();
    await expectCode(
      unwrapConversationKey(
        wrapped.wrappedKey,
        wrapped.signature,
        bob.extractable.ecdhPrivate,
        await importSignPublic(mallory.signPublicKey),
        ctx,
      ),
      "bad-signature",
    );
  });

  it("rechaza contexto distinto (otra conversación/época/destinatario)", async () => {
    const { alice, bob, ctx, wrapped } = await setup();
    const signer = await importSignPublic(alice.signPublicKey);
    for (const bad of [
      { ...ctx, conversationId: "c2" },
      { ...ctx, epoch: 2 },
      { ...ctx, recipientId: "eve" },
    ]) {
      await expectCode(
        unwrapConversationKey(wrapped.wrappedKey, wrapped.signature, bob.extractable.ecdhPrivate, signer, bad),
        "bad-signature",
      );
    }
  });

  it("un tercero no puede abrir la clave aunque la firma sea válida", async () => {
    const { alice, ctx, wrapped } = await setup();
    const eve = await generateIdentity();
    await expectCode(
      unwrapConversationKey(
        wrapped.wrappedKey,
        wrapped.signature,
        eve.extractable.ecdhPrivate,
        await importSignPublic(alice.signPublicKey),
        ctx,
      ),
      "bad-ciphertext",
    );
  });
});

describe("mensajes", () => {
  async function setup() {
    const sender = await generateIdentity();
    const key = await importConversationKey(generateConversationKeyBytes());
    const ctx = { conversationId: "c1", epoch: 3, senderId: "alice" };
    const verify = await importSignPublic(sender.signPublicKey);
    return { sender, key, ctx, verify };
  }

  it("ida y vuelta con unicode y adjuntos", async () => {
    const { sender, key, ctx, verify } = await setup();
    const payload = { v: 1, text: "Hola 👋 ñandú — 你好", attachments: [{ ref: "r", key: "k" }] };
    const blob = await encryptMessagePayload(key, sender.extractable.signPrivate, ctx, payload);
    assert.deepEqual(await decryptMessagePayload(key, verify, ctx, blob), payload);
  });

  it("el texto plano no aparece en el cifrado y dos cifrados del mismo texto difieren", async () => {
    const { sender, key, ctx } = await setup();
    const secret = "contraseña-super-secreta-del-servidor";
    const a = await encryptMessagePayload(key, sender.extractable.signPrivate, ctx, { text: secret });
    const b = await encryptMessagePayload(key, sender.extractable.signPrivate, ctx, { text: secret });
    assert.notEqual(a, b);
    assert.ok(!Buffer.from(a, "base64").toString("latin1").includes(secret));
  });

  it("el relleno oculta la longitud exacta (bloques de 64 bytes)", async () => {
    const { sender, key, ctx } = await setup();
    const len = async (text: string) =>
      Buffer.from(
        await encryptMessagePayload(key, sender.extractable.signPrivate, ctx, { text }),
        "base64",
      ).length;
    assert.equal(await len("a"), await len("abcdefghij"));
  });

  it("detecta manipulación, otro contexto y firma de otro remitente", async () => {
    const { sender, key, ctx, verify } = await setup();
    const blob = await encryptMessagePayload(key, sender.extractable.signPrivate, ctx, { text: "hola" });

    const tampered = Buffer.from(blob, "base64");
    tampered[14] ^= 1;
    await expectCode(
      decryptMessagePayload(key, verify, ctx, tampered.toString("base64")),
      "bad-signature",
    );

    for (const bad of [
      { ...ctx, conversationId: "c2" },
      { ...ctx, epoch: 4 },
      { ...ctx, senderId: "bob" },
    ]) {
      await expectCode(decryptMessagePayload(key, verify, bad, blob), "bad-signature");
    }

    const other = await generateIdentity();
    await expectCode(
      decryptMessagePayload(key, await importSignPublic(other.signPublicKey), ctx, blob),
      "bad-signature",
    );
  });

  it("una clave de otra época no descifra", async () => {
    const { sender, key, ctx, verify } = await setup();
    const blob = await encryptMessagePayload(key, sender.extractable.signPrivate, ctx, { text: "hola" });
    const wrongKey = await importConversationKey(generateConversationKeyBytes());
    await expectCode(decryptMessagePayload(wrongKey, verify, ctx, blob), "bad-ciphertext");
  });
});

describe("archivos", () => {
  it("ida y vuelta, sin texto plano en el blob", async () => {
    const data = new TextEncoder().encode("nombre,saldo\nana,1000\nbeto,2000\n");
    const { blob, key } = await encryptFile(data.buffer, "ref-1");
    assert.equal(blob.length, data.length + 28);
    assert.ok(!Buffer.from(blob).toString("utf8").includes("ana,1000"));
    const plain = await decryptFile(blob.buffer, key, "ref-1");
    assert.deepEqual(new Uint8Array(plain), data);
  });

  it("falla con otra clave, otro ref o datos alterados", async () => {
    const data = new TextEncoder().encode("contenido");
    const { blob, key } = await encryptFile(data.buffer, "ref-1");
    const other = await encryptFile(data.buffer, "ref-1");
    await expectCode(decryptFile(blob.buffer, other.key, "ref-1"), "bad-ciphertext");
    await expectCode(decryptFile(blob.buffer, key, "ref-2"), "bad-ciphertext");
    const tampered = new Uint8Array(blob);
    tampered[tampered.length - 1] ^= 1;
    await expectCode(decryptFile(tampered.buffer, key, "ref-1"), "bad-ciphertext");
  });
});
