-- E2EE: claves de usuario, claves de conversación por época, mensajes y adjuntos cifrados.
-- Los mensajes y adjuntos existentes NO se tocan: siguen en claro (content / fileName)
-- hasta que su dueño los migra desde el cliente (ver docs de migración E2EE).

-- AlterTable
ALTER TABLE "conversations"
  ADD COLUMN "currentEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "keyRotationPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "messages"
  ADD COLUMN "ciphertext" TEXT,
  ADD COLUMN "keyEpoch" INTEGER;

-- AlterTable
ALTER TABLE "attachments"
  ADD COLUMN "ref" TEXT,
  ADD COLUMN "encSize" INTEGER,
  ALTER COLUMN "fileName" DROP NOT NULL,
  ALTER COLUMN "fileType" DROP NOT NULL,
  ALTER COLUMN "fileSize" DROP NOT NULL;

-- DropIndex: la búsqueda ya no ocurre en el servidor (no puede leer el contenido).
DROP INDEX IF EXISTS "messages_content_idx";
DROP INDEX IF EXISTS "attachments_fileName_idx";

-- CreateTable
CREATE TABLE "user_keys" (
    "userId" TEXT NOT NULL,
    "ecdhPublicKey" TEXT NOT NULL,
    "signPublicKey" TEXT NOT NULL,
    "encryptedPrivateKeys" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_keys_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "conversation_keys" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "wrappedById" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_keys_conversationId_epoch_userId_key" ON "conversation_keys"("conversationId", "epoch", "userId");

-- CreateIndex
CREATE INDEX "conversation_keys_userId_conversationId_idx" ON "conversation_keys"("userId", "conversationId");

-- AddForeignKey
ALTER TABLE "user_keys" ADD CONSTRAINT "user_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_keys" ADD CONSTRAINT "conversation_keys_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_keys" ADD CONSTRAINT "conversation_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_keys" ADD CONSTRAINT "conversation_keys_wrappedById_fkey" FOREIGN KEY ("wrappedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defensa en profundidad: sin políticas, anon/authenticated no pueden leer estas tablas
-- por PostgREST (Prisma usa el rol postgres, que ignora RLS). Igual que scripts/setup-realtime.ts.
ALTER TABLE "user_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_keys" ENABLE ROW LEVEL SECURITY;
