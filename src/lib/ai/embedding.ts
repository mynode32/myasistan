const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

type EmbeddingResponse = {
  data?: { embedding?: number[] }[];
  error?: { message?: string };
};

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY tanımlı değil.");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  const data = (await response.json()) as EmbeddingResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? "Embedding oluşturulamadı.");
  }

  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Embedding yanıtı beklenen boyutta değil.");
  }

  return embedding;
}
