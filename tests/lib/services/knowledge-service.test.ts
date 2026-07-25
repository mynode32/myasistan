import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { KnowledgeDocument, PrismaClient } from "@/generated/prisma/client";
import { generateEmbedding } from "@/lib/ai/embedding";
import { prisma } from "@/lib/db/prisma";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  updateKnowledgeDocument,
} from "@/lib/services/knowledge-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/ai/embedding", () => ({
  generateEmbedding: vi.fn(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const generateEmbeddingMock = vi.mocked(generateEmbedding);

beforeEach(() => {
  mockReset(prismaMock);
  generateEmbeddingMock.mockReset();
  generateEmbeddingMock.mockResolvedValue(Array(1536).fill(0.1));
  // Interactive transactions run the callback against the same mock client,
  // so assertions against prismaMock also cover calls made through `tx`.
  prismaMock.$transaction.mockImplementation((fn) =>
    (fn as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock),
  );
});

describe("createKnowledgeDocument", () => {
  it("creates a tenant-scoped document and stores embedded chunks", async () => {
    const document = {
      id: "doc_1",
      storeId: "store_1",
      sourceType: "FAQ",
      title: "İade",
      content: "İade süresi 14 gündür.",
      language: "tr",
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies KnowledgeDocument;
    prismaMock.knowledgeDocument.create.mockResolvedValue(document);

    const result = await createKnowledgeDocument("store_1", {
      sourceType: "FAQ",
      title: "İade",
      content: "İade süresi 14 gündür.",
      language: "tr",
    });

    expect(result).toEqual(document);
    expect(prismaMock.knowledgeDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storeId: "store_1", sourceType: "FAQ" }),
      }),
    );
    expect(generateEmbeddingMock).toHaveBeenCalledWith("İade\n\nİade süresi 14 gündür.");
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "knowledge_chunks"'),
      "store_1",
      "doc_1",
    );
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "knowledge_chunks"'),
      "store_1",
      "FAQ",
      "doc_1",
      null,
      null,
      "tr",
      0,
      "İade\n\nİade süresi 14 gündür.",
      expect.stringMatching(/^\[/),
    );
  });

  it("does not create the document when embedding a chunk fails", async () => {
    generateEmbeddingMock.mockRejectedValueOnce(new Error("OpenAI down"));

    await expect(
      createKnowledgeDocument("store_1", {
        sourceType: "FAQ",
        title: "İade",
        content: "İade süresi 14 gündür.",
        language: "tr",
      }),
    ).rejects.toThrow("OpenAI down");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.knowledgeDocument.create).not.toHaveBeenCalled();
    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("updateKnowledgeDocument", () => {
  it("requires the document to belong to the store before replacing chunks", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue(null);

    await expect(updateKnowledgeDocument("store_1", "doc_1", { title: "Yeni" })).rejects.toThrow(
      "Bilgi dokümanı bulunamadı.",
    );
    expect(prismaMock.knowledgeDocument.update).not.toHaveBeenCalled();
  });

  it("does not update the document when embedding a chunk fails", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc_1",
      storeId: "store_1",
      sourceType: "FAQ",
      title: "Eski",
      content: "Eski içerik",
      language: "tr",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as KnowledgeDocument);
    generateEmbeddingMock.mockRejectedValueOnce(new Error("OpenAI down"));

    await expect(
      updateKnowledgeDocument("store_1", "doc_1", { content: "Yeni içerik" }),
    ).rejects.toThrow("OpenAI down");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.knowledgeDocument.update).not.toHaveBeenCalled();
  });
});

describe("deleteKnowledgeDocument", () => {
  it("deletes chunks before deleting the document", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc_1",
      storeId: "store_1",
    } as KnowledgeDocument);
    prismaMock.knowledgeDocument.delete.mockResolvedValue({} as KnowledgeDocument);

    await deleteKnowledgeDocument("store_1", "doc_1");

    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "knowledge_chunks"'),
      "store_1",
      "doc_1",
    );
    expect(prismaMock.knowledgeDocument.delete).toHaveBeenCalledWith({ where: { id: "doc_1" } });
  });
});
