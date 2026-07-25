-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('PRODUCT', 'FAQ', 'SHIPPING_POLICY', 'RETURN_POLICY', 'WARRANTY', 'CAMPAIGN', 'BLOG', 'CUSTOM');

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_storeId_idx" ON "knowledge_documents"("storeId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_storeId_idx" ON "knowledge_chunks"("storeId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_sourceId_idx" ON "knowledge_chunks"("sourceId");

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
