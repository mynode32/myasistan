import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { generateGroundedAnswer } from "@/lib/ai/chat";
import { generateEmbedding } from "@/lib/ai/embedding";
import { prisma } from "@/lib/db/prisma";
import { queryKnowledge } from "@/lib/services/rag-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/ai/embedding", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("@/lib/ai/chat", () => ({
  generateGroundedAnswer: vi.fn(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const generateEmbeddingMock = vi.mocked(generateEmbedding);
const generateGroundedAnswerMock = vi.mocked(generateGroundedAnswer);

beforeEach(() => {
  mockReset(prismaMock);
  generateEmbeddingMock.mockReset();
  generateGroundedAnswerMock.mockReset();
  generateEmbeddingMock.mockResolvedValue(Array(1536).fill(0.2));
});

describe("queryKnowledge", () => {
  it("short-circuits when the store has no chunks", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const result = await queryKnowledge("store_1", "İade kaç gün?");

    expect(result.sources).toEqual([]);
    expect(result.answer).toContain("henüz bilgi eklenmemiş");
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("retrieves tenant-scoped chunks and generates a grounded answer", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      {
        sourceType: "FAQ",
        sourceId: "doc_1",
        content: "İade süresi 14 gündür.",
        distance: 0.1,
      },
    ]);
    generateGroundedAnswerMock.mockResolvedValue("İade süresi 14 gündür.");

    const result = await queryKnowledge("store_1", "İade kaç gün?", 3);

    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('WHERE "storeId" = $1'),
      "store_1",
      expect.stringMatching(/^\[/),
      3,
    );
    expect(generateGroundedAnswerMock).toHaveBeenCalledWith(
      "İade kaç gün?",
      expect.stringContaining("İade süresi 14 gündür."),
    );
    expect(result).toEqual({
      answer: "İade süresi 14 gündür.",
      sources: [{ sourceType: "FAQ", sourceId: "doc_1", content: "İade süresi 14 gündür." }],
    });
  });
});
