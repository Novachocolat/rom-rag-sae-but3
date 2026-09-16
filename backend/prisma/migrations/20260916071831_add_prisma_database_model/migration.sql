/*
  Warnings:

  - Added the required column `passwordHash` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "IdentificationSource" AS ENUM ('DAT_SHA1', 'DAT_MD5', 'DAT_NAME', 'AI_PROPOSED', 'USER_CONFIRMED', 'UNIDENTIFIED');

-- CreateEnum
CREATE TYPE "AiProposalKind" AS ENUM ('IDENTIFICATION', 'GROUPING');

-- CreateEnum
CREATE TYPE "AiProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CollectionSource" AS ENUM ('DAT_CLONE', 'AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "passwordHash" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "Platform" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "extensions" TEXT[],

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatFile" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "headerName" TEXT NOT NULL,
    "version" TEXT,
    "fileName" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentSha1" TEXT NOT NULL,

    CONSTRAINT "DatFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatEntry" (
    "id" TEXT NOT NULL,
    "datFileId" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "gameExternalId" TEXT NOT NULL,
    "cloneOfId" TEXT,
    "description" TEXT NOT NULL,
    "categories" TEXT[],
    "serial" TEXT,
    "romName" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "crc" TEXT,
    "md5" TEXT,
    "sha1" TEXT,
    "sha256" TEXT,
    "status" TEXT,

    CONSTRAINT "DatEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rom" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "md5" TEXT NOT NULL,
    "sha1" TEXT NOT NULL,
    "crc32" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScannedAt" TIMESTAMP(3) NOT NULL,
    "platformId" TEXT,
    "datEntryId" TEXT,
    "identificationSource" "IdentificationSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "title" TEXT,
    "region" TEXT,
    "languages" TEXT[],
    "releaseYear" INTEGER,
    "publisher" TEXT,
    "genre" TEXT,
    "summary" TEXT,

    CONSTRAINT "Rom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "kind" "AiProposalKind" NOT NULL,
    "romId" TEXT,
    "groupId" TEXT,
    "payload" JSONB NOT NULL,
    "rawResponse" TEXT,
    "model" TEXT NOT NULL,
    "promptName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "AiProposalStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "durationMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canonicalTitle" TEXT NOT NULL,
    "platformId" TEXT,
    "source" "CollectionSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionMember" (
    "groupId" TEXT NOT NULL,
    "romId" TEXT NOT NULL,
    "variantLabel" TEXT,

    CONSTRAINT "CollectionMember_pkey" PRIMARY KEY ("groupId","romId")
);

-- CreateTable
CREATE TABLE "RomEmbedding" (
    "romId" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RomEmbedding_pkey" PRIMARY KEY ("romId")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rootRelativePath" TEXT NOT NULL,
    "status" "ScanJobStatus" NOT NULL,
    "totalFiles" INTEGER NOT NULL,
    "processedFiles" INTEGER NOT NULL,
    "identifiedCount" INTEGER NOT NULL,
    "unidentifiedCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Platform_slug_key" ON "Platform"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "DatFile_contentSha1_key" ON "DatFile"("contentSha1");

-- CreateIndex
CREATE INDEX "DatEntry_md5_idx" ON "DatEntry"("md5");

-- CreateIndex
CREATE INDEX "DatEntry_sha1_idx" ON "DatEntry"("sha1");

-- CreateIndex
CREATE INDEX "DatEntry_datFileId_idx" ON "DatEntry"("datFileId");

-- CreateIndex
CREATE INDEX "DatEntry_gameName_idx" ON "DatEntry"("gameName");

-- CreateIndex
CREATE INDEX "Rom_userId_sha1_idx" ON "Rom"("userId", "sha1");

-- CreateIndex
CREATE UNIQUE INDEX "Rom_userId_relativePath_key" ON "Rom"("userId", "relativePath");

-- AddForeignKey
ALTER TABLE "DatFile" ADD CONSTRAINT "DatFile_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatEntry" ADD CONSTRAINT "DatEntry_datFileId_fkey" FOREIGN KEY ("datFileId") REFERENCES "DatFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rom" ADD CONSTRAINT "Rom_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rom" ADD CONSTRAINT "Rom_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rom" ADD CONSTRAINT "Rom_datEntryId_fkey" FOREIGN KEY ("datEntryId") REFERENCES "DatEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_romId_fkey" FOREIGN KEY ("romId") REFERENCES "Rom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMember" ADD CONSTRAINT "CollectionMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMember" ADD CONSTRAINT "CollectionMember_romId_fkey" FOREIGN KEY ("romId") REFERENCES "Rom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RomEmbedding" ADD CONSTRAINT "RomEmbedding_romId_fkey" FOREIGN KEY ("romId") REFERENCES "Rom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
