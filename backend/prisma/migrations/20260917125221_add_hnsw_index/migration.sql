--! MANUALLY INSERTED INSTRUCTIONS TO HANDLE pgvector EXTENSION WITH PRISMA 7
--! DO NO ALTER THIS FILE BY HAND 

-- 1. Checks if the pgvector extension exists
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Adds a vector column of 768 dimensions to RomEmbedding
ALTER TABLE "RomEmbedding" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- 3. Creates a performance index using HNSW for cosinus similarity
CREATE INDEX IF NOT EXISTS romembedding_embedding_hnsw
ON "RomEmbedding"
USING hnsw ("embedding" vector_cosine_ops);