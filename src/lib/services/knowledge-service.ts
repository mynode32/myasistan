import type {
  KnowledgeDocument,
  KnowledgeSourceType,
  Prisma,
  Product,
  ProductVariant,
} from "@/generated/prisma/client";
import { generateEmbedding } from "@/lib/ai/embedding";
import { prisma } from "@/lib/db/prisma";
import { chunkText } from "@/lib/knowledge/chunking";
import type {
  CreateKnowledgeDocumentInput,
  UpdateKnowledgeDocumentInput,
} from "@/lib/validation/knowledge";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

const PRODUCT_SOURCE_TYPE = "PRODUCT" satisfies KnowledgeSourceType;

type EmbeddedChunk = { content: string; embedding: number[] };

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// Embeds every chunk before any database write happens, so a failed OpenAI
// call (e.g. on chunk 2 of 3) never leaves a document or product with old
// chunks deleted but new ones only partially written.
async function embedChunks(chunks: string[]): Promise<EmbeddedChunk[]> {
  const embedded: EmbeddedChunk[] = [];
  for (const content of chunks) {
    embedded.push({ content, embedding: await generateEmbedding(content) });
  }
  return embedded;
}

async function writeChunks(
  tx: Prisma.TransactionClient,
  input: {
    storeId: string;
    sourceType: KnowledgeSourceType;
    sourceId: string;
    productId?: string | null;
    categoryId?: string | null;
    language?: string;
    embeddedChunks: EmbeddedChunk[];
  },
) {
  await tx.$executeRawUnsafe(
    'DELETE FROM "knowledge_chunks" WHERE "storeId" = $1 AND "sourceId" = $2',
    input.storeId,
    input.sourceId,
  );

  for (const [chunkIndex, { content, embedding }] of input.embeddedChunks.entries()) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "knowledge_chunks"
        ("id", "storeId", "sourceType", "sourceId", "productId", "categoryId", "language", "chunkIndex", "content", "embedding")
       VALUES
        (gen_random_uuid()::text, $1, $2::"KnowledgeSourceType", $3, $4, $5, $6, $7, $8, $9::vector)`,
      input.storeId,
      input.sourceType,
      input.sourceId,
      input.productId ?? null,
      input.categoryId ?? null,
      input.language ?? "tr",
      chunkIndex,
      content,
      vectorLiteral(embedding),
    );
  }
}

export async function createKnowledgeDocument(
  storeId: string,
  input: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  const embeddedChunks = await embedChunks(chunkText(`${input.title}\n\n${input.content}`));

  return prisma.$transaction(async (tx) => {
    const document = await tx.knowledgeDocument.create({
      data: {
        storeId,
        sourceType: input.sourceType,
        title: input.title,
        content: input.content,
        language: input.language,
      },
    });

    await writeChunks(tx, {
      storeId,
      sourceType: document.sourceType,
      sourceId: document.id,
      language: document.language,
      embeddedChunks,
    });

    return document;
  });
}

export async function listKnowledgeDocuments(storeId: string): Promise<KnowledgeDocument[]> {
  return prisma.knowledgeDocument.findMany({
    where: { storeId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getKnowledgeDocumentById(
  storeId: string,
  id: string,
): Promise<KnowledgeDocument | null> {
  return prisma.knowledgeDocument.findFirst({
    where: { id, storeId },
  });
}

export async function updateKnowledgeDocument(
  storeId: string,
  id: string,
  input: UpdateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  const existing = await getKnowledgeDocumentById(storeId, id);
  if (!existing) {
    throw new Error("Bilgi dokümanı bulunamadı.");
  }

  const nextTitle = input.title ?? existing.title;
  const nextContent = input.content ?? existing.content;
  const embeddedChunks = await embedChunks(chunkText(`${nextTitle}\n\n${nextContent}`));

  return prisma.$transaction(async (tx) => {
    const document = await tx.knowledgeDocument.update({
      where: { id },
      data: input,
    });

    await writeChunks(tx, {
      storeId,
      sourceType: document.sourceType,
      sourceId: document.id,
      language: document.language,
      embeddedChunks,
    });

    return document;
  });
}

export async function deleteKnowledgeDocument(storeId: string, id: string): Promise<void> {
  const existing = await getKnowledgeDocumentById(storeId, id);
  if (!existing) {
    throw new Error("Bilgi dokümanı bulunamadı.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'DELETE FROM "knowledge_chunks" WHERE "storeId" = $1 AND "sourceId" = $2',
      storeId,
      id,
    );
    await tx.knowledgeDocument.delete({ where: { id } });
  });
}

function productToKnowledgeText(product: ProductWithVariants): string {
  const lines = [
    `Ürün: ${product.title}`,
    product.description ? `Açıklama: ${product.description}` : null,
    product.brand ? `Marka: ${product.brand}` : null,
    product.categoryId ? `Kategori: ${product.categoryId}` : null,
    product.url ? `URL: ${product.url}` : null,
  ].filter(Boolean);

  const prices = product.variants.map((variant) => Number(variant.price));
  if (prices.length > 0) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const currency = product.variants[0]?.currency ?? "TRY";
    lines.push(min === max ? `Fiyat: ${min} ${currency}` : `Fiyat aralığı: ${min}-${max} ${currency}`);
  }

  const totalStock = product.variants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
  lines.push(`Toplam stok: ${totalStock}`);

  return lines.join("\n");
}

export async function syncProductChunks(
  storeId: string,
  product: ProductWithVariants,
): Promise<void> {
  const embeddedChunks = await embedChunks([productToKnowledgeText(product)]);

  await prisma.$transaction(async (tx) => {
    await writeChunks(tx, {
      storeId,
      sourceType: PRODUCT_SOURCE_TYPE,
      sourceId: product.id,
      productId: product.id,
      categoryId: product.categoryId,
      language: "tr",
      embeddedChunks,
    });
  });
}

export async function deleteProductChunks(storeId: string, productId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DELETE FROM "knowledge_chunks" WHERE "storeId" = $1 AND "sourceId" = $2',
    storeId,
    productId,
  );
}
