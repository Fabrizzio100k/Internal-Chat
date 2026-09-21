-- Migración manual: introduce ConversationParticipant (tabla intermedia
-- muchos-a-muchos entre User y Conversation) reemplazando las columnas
-- userAId/userBId directas en Conversation. Preserva los datos existentes
-- migrando cada fila de conversations a dos filas de conversation_participants.

-- 1. Crear la nueva tabla
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key"
    ON "conversation_participants"("conversationId", "userId");

CREATE INDEX "conversation_participants_userId_idx"
    ON "conversation_participants"("userId");

ALTER TABLE "conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_participants"
    ADD CONSTRAINT "conversation_participants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Migrar los datos existentes: cada conversación tenía userAId y userBId,
-- ahora se convierten en dos filas de conversation_participants.
INSERT INTO "conversation_participants" ("id", "conversationId", "userId", "joinedAt")
SELECT
    "userAId" || '_' || "id",
    "id",
    "userAId",
    "createdAt"
FROM "conversations";

INSERT INTO "conversation_participants" ("id", "conversationId", "userId", "joinedAt")
SELECT
    "userBId" || '_' || "id",
    "id",
    "userBId",
    "createdAt"
FROM "conversations";

-- 3. Eliminar las foreign keys y columnas viejas de conversations
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_userAId_fkey";
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_userBId_fkey";
DROP INDEX IF EXISTS "conversations_userAId_userBId_key";

ALTER TABLE "conversations" DROP COLUMN "userAId";
ALTER TABLE "conversations" DROP COLUMN "userBId";
