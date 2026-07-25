-- Align the live table with the Prisma schema and ensure tenant cleanup cascades.
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET NOT NULL;

ALTER TABLE "knowledge_chunks"
ADD CONSTRAINT "knowledge_chunks_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "stores"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
