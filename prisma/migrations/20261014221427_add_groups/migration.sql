-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT;

-- CreateIndex
CREATE INDEX "attachments_messageId_idx" ON "attachments"("messageId");
