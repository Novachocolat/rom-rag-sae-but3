/*
  Warnings:

  - You are about to drop the column `groupId` on the `AiProposal` table. All the data in the column will be lost.
  - The primary key for the `CollectionMember` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `groupId` on the `CollectionMember` table. All the data in the column will be lost.
  - Added the required column `collectionId` to the `CollectionMember` table without a default value. This is not possible if the table is not empty.
  - Made the column `embedding` on table `RomEmbedding` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "AiProposal" DROP CONSTRAINT "AiProposal_groupId_fkey";

-- DropForeignKey
ALTER TABLE "CollectionMember" DROP CONSTRAINT "CollectionMember_groupId_fkey";

-- DropIndex
DROP INDEX "romembedding_embedding_hnsw";

-- AlterTable
ALTER TABLE "AiProposal" DROP COLUMN "groupId",
ADD COLUMN     "collectionId" TEXT;

-- AlterTable
ALTER TABLE "CollectionMember" DROP CONSTRAINT "CollectionMember_pkey",
DROP COLUMN "groupId",
ADD COLUMN     "collectionId" TEXT NOT NULL,
ADD CONSTRAINT "CollectionMember_pkey" PRIMARY KEY ("collectionId", "romId");

-- AlterTable
ALTER TABLE "RomEmbedding" ALTER COLUMN "embedding" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMember" ADD CONSTRAINT "CollectionMember_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
