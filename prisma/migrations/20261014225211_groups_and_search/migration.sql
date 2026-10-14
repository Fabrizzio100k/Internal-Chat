CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('MEMBER', 'ADMIN');

-- AlterTable
ALTER TABLE "conversation_participants" ADD COLUMN     "role" "ParticipantRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "kind" TEXT,
ADD COLUMN     "targetUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "attachments_fileName_idx" ON "attachments" USING GIN ("fileName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "messages_content_idx" ON "messages" USING GIN ("content" gin_trgm_ops);
