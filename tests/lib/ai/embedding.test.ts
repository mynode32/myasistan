import { afterEach, describe, expect, it, vi } from "vitest";
import { generateEmbedding } from "@/lib/ai/embedding";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generateEmbedding", () => {
  it("calls OpenAI with the configured embedding shape", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const embedding = Array(1536).fill(0.25);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateEmbedding("kargo bilgisi")).resolves.toEqual(embedding);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: "kargo bilgisi",
          dimensions: 1536,
        }),
      }),
    );
  });

  it("rejects malformed embedding responses", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 }),
      ),
    );

    await expect(generateEmbedding("test")).rejects.toThrow("beklenen boyutta");
  });
});
