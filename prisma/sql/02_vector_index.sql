-- Run after `prisma db push`, once Dop.embedding exists.
-- HNSW indexes up to 2000 dimensions, which is why DOP embeddings are generated
-- at 1536 dims (text-embedding-3-large, shortened via the dimensions parameter).
CREATE INDEX IF NOT EXISTS dop_embedding_hnsw
  ON "Dop" USING hnsw (embedding vector_cosine_ops);
