import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/knowledge/chunking";

describe("chunkText", () => {
  it("keeps short text in one chunk", () => {
    expect(chunkText("Kısa bilgi metni.", 1000)).toEqual(["Kısa bilgi metni."]);
  });

  it("splits by paragraphs when the combined text exceeds maxChars", () => {
    const chunks = chunkText("Birinci paragraf.\n\nİkinci paragraf uzun.", 28);

    expect(chunks).toEqual(["Birinci paragraf.", "İkinci paragraf uzun."]);
  });

  it("hard-splits a single oversized paragraph", () => {
    expect(chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});
