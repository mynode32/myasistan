import type { KnowledgeSourceType } from "@/generated/prisma/client";
import { generateGroundedAnswer } from "@/lib/ai/chat";
import { generateEmbedding } from "@/lib/ai/embedding";
import { prisma } from "@/lib/db/prisma";

export type RagSource = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  content: string;
};

export type RagQueryResult = {
  answer: string;
  sources: RagSource[];
};

type KnowledgeChunkMatch = RagSource & {
  distance: number;
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function queryKnowledge(
  storeId: string,
  question: string,
  topK = 5,
): Promise<RagQueryResult> {
  const questionEmbedding = await generateEmbedding(question);
  const matches = await prisma.$queryRawUnsafe<KnowledgeChunkMatch[]>(
    `SELECT "sourceType", "sourceId", "content", "embedding" <=> $2::vector AS "distance"
     FROM "knowledge_chunks"
     WHERE "storeId" = $1
     ORDER BY "embedding" <=> $2::vector
     LIMIT $3`,
    storeId,
    vectorLiteral(questionEmbedding),
    topK,
  );

  if (matches.length === 0) {
    return {
      answer: "Bu mağaza için henüz bilgi eklenmemiş. Ürün veya bilgi dokümanı ekledikten sonra tekrar deneyin.",
      sources: [],
    };
  }

  const context = matches
    .map((match, index) => `[Kaynak ${index + 1} - ${match.sourceType}]\n${match.content}`)
    .join("\n\n");
  const answer = await generateGroundedAnswer(question, context);

  return {
    answer,
    sources: matches.map(({ sourceType, sourceId, content }) => ({ sourceType, sourceId, content })),
  };
}
