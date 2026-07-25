import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth/jwt";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocumentById,
  updateKnowledgeDocument,
} from "@/lib/services/knowledge-service";
import { queryKnowledge } from "@/lib/services/rag-service";
import { POST as createKnowledge } from "@/app/api/knowledge/route";
import {
  DELETE as deleteKnowledge,
  PATCH as updateKnowledge,
} from "@/app/api/knowledge/[documentId]/route";
import { POST as queryRag } from "@/app/api/rag/query/route";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth/jwt", () => ({ verifySessionToken: vi.fn() }));
vi.mock("@/lib/services/knowledge-service", () => ({
  createKnowledgeDocument: vi.fn(),
  deleteKnowledgeDocument: vi.fn(),
  getKnowledgeDocumentById: vi.fn(),
  listKnowledgeDocuments: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}));
vi.mock("@/lib/services/rag-service", () => ({ queryKnowledge: vi.fn() }));

const cookiesMock = vi.mocked(cookies);
const verifySessionTokenMock = vi.mocked(verifySessionToken);
const createKnowledgeDocumentMock = vi.mocked(createKnowledgeDocument);
const deleteKnowledgeDocumentMock = vi.mocked(deleteKnowledgeDocument);
const getKnowledgeDocumentByIdMock = vi.mocked(getKnowledgeDocumentById);
const updateKnowledgeDocumentMock = vi.mocked(updateKnowledgeDocument);
const queryKnowledgeMock = vi.mocked(queryKnowledge);
const routeParams = { params: Promise.resolve({ documentId: "doc_1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  cookiesMock.mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: "valid-token" }),
  } as never);
  verifySessionTokenMock.mockResolvedValue({
    userId: "user_1",
    storeId: "store_1",
    email: "owner@example.com",
  });
});

describe("knowledge collection route", () => {
  it("returns 400 for malformed JSON", async () => {
    const response = await createKnowledge(
      new Request("http://localhost/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Geçersiz JSON." });
    expect(createKnowledgeDocumentMock).not.toHaveBeenCalled();
  });

  it("uses the store id from the verified session", async () => {
    createKnowledgeDocumentMock.mockResolvedValue({ id: "doc_1" } as never);
    const input = {
      sourceType: "FAQ",
      title: "Kargo",
      content: "Kargo 2-3 iş gününde teslim edilir.",
      language: "tr",
    };

    const response = await createKnowledge(
      new Request("http://localhost/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );

    expect(response.status).toBe(201);
    expect(createKnowledgeDocumentMock).toHaveBeenCalledWith("store_1", input);
  });
});

describe("knowledge item route", () => {
  it("returns 404 only when the tenant-scoped document does not exist", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValue(null);

    const response = await updateKnowledge(
      new Request("http://localhost/api/knowledge/doc_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Yeni başlık" }),
      }),
      routeParams,
    );

    expect(response.status).toBe(404);
    expect(getKnowledgeDocumentByIdMock).toHaveBeenCalledWith("store_1", "doc_1");
    expect(updateKnowledgeDocumentMock).not.toHaveBeenCalled();
  });

  it("returns 500 when an existing document cannot be updated", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValue({ id: "doc_1" } as never);
    updateKnowledgeDocumentMock.mockRejectedValue(new Error("embedding unavailable"));

    const response = await updateKnowledge(
      new Request("http://localhost/api/knowledge/doc_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Yeni başlık" }),
      }),
      routeParams,
    );

    expect(response.status).toBe(500);
  });

  it("does not delete a document belonging to another store", async () => {
    getKnowledgeDocumentByIdMock.mockResolvedValue(null);

    const response = await deleteKnowledge(
      new Request("http://localhost/api/knowledge/doc_1", { method: "DELETE" }),
      routeParams,
    );

    expect(response.status).toBe(404);
    expect(deleteKnowledgeDocumentMock).not.toHaveBeenCalled();
  });
});

describe("RAG query route", () => {
  it("passes the verified store id to the RAG service", async () => {
    queryKnowledgeMock.mockResolvedValue({ answer: "2-3 iş günü.", sources: [] });

    const response = await queryRag(
      new Request("http://localhost/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Kargo ne zaman gelir?" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(queryKnowledgeMock).toHaveBeenCalledWith("store_1", "Kargo ne zaman gelir?");
  });

  it("returns 502 when the RAG dependency fails", async () => {
    queryKnowledgeMock.mockRejectedValue(new Error("OpenAI unavailable"));

    const response = await queryRag(
      new Request("http://localhost/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Kargo ne zaman gelir?" }),
      }),
    );

    expect(response.status).toBe(502);
  });
});
