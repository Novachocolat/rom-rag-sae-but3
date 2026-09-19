/*
  Warnings:

  - Made the column `embedding` on table `RomEmbedding` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IdentificationSource" ADD VALUE 'DAT_SHA1_DATA';
ALTER TYPE "IdentificationSource" ADD VALUE 'DAT_MD5_DATA';

-- AlterTable
ALTER TABLE "Rom" ADD COLUMN     "headerBytesSkipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "md5Data" TEXT,
ADD COLUMN     "sha1Data" TEXT;

-- AlterTable
ALTER TABLE "RomEmbedding" ALTER COLUMN "embedding" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Rom_userId_sha1Data_idx" ON "Rom"("userId", "sha1Data");
