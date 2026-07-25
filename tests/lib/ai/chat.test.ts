import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGroundedAnswer } from "@/lib/ai/chat";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generateGroundedAnswer", () => {
  it("sends the question and context to OpenAI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "  Kargo 2-3 iş günüdür.  " } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGroundedAnswer("Kargo ne zaman gelir?", "Kargo 2-3 iş gününde teslim edilir."),
    ).resolves.toBe("Kargo 2-3 iş günüdür.");

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[1]?.content).toContain("Kargo ne zaman gelir?");
    expect(body.messages[1]?.content).toContain("Kargo 2-3 iş gününde teslim edilir.");
  });

  it("surfaces the OpenAI error message", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 }),
      ),
    );

    await expect(generateGroundedAnswer("Soru", "Bağlam")).rejects.toThrow("quota exceeded");
  });
});
