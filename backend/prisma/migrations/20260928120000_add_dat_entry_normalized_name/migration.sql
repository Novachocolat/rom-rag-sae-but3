-- AlterTable
ALTER TABLE "DatEntry" ADD COLUMN     "normalizedName" TEXT;

-- CreateIndex
CREATE INDEX "DatEntry_normalizedName_idx" ON "DatEntry"("normalizedName");
