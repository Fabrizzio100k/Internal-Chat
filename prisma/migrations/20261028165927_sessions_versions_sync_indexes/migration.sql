-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastSeenVersion" TEXT;

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'desktop',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_userId_revokedAt_expiresAt_idx" ON "user_sessions"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_editedAt_idx" ON "messages"("conversationId", "editedAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_deletedAt_idx" ON "messages"("conversationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
