# Sprint 2: Knowledge Ingestion, Embedding, Vector Search, RAG Endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each store a queryable knowledge base — auto-synced product catalog plus manually-entered FAQ/policy/campaign/blog/custom content — embedded into pgvector, retrievable through a single RAG query endpoint that returns an LLM-generated, context-grounded answer.

**Architecture:** Same layering as Sprint 1 — thin Next.js API routes call small service functions in `src/lib/services/`. A new `src/lib/ai/` holds thin OpenAI SDK wrappers (embedding + chat), consumed by services, never called directly from routes. Embeddings live in a single `KnowledgeChunk` Prisma model with an `Unsupported("vector(1536)")` column; all vector reads/writes go through raw SQL since Prisma has no native vector type.

**Tech Stack:** Next.js 16 (existing), Prisma 7 + pgvector (`@prisma/adapter-pg`, existing), `openai` npm package (new), OpenAI `text-embedding-3-small` for embeddings, `gpt-4o-mini` for grounded answers, Vitest + vitest-mock-extended (existing).

**Design spec:** `docs/superpowers/specs/2026-07-25-sprint2-rag-knowledge-design.md` — read this first for full rationale; this plan implements it task-by-task.

## Global Constraints

- Source coverage: product (auto-synced from `Product`/`ProductVariant`) + FAQ/shipping/return/warranty/campaign/blog/custom (manual admin text entry only) — no web scraping, no Ikas sync this sprint.
- Product embedding sync is **automatic and inline** in `product-service.ts`'s `createProduct`/`updateProduct`/`deleteProduct` — no separate sync button. CSV import is covered for free (it already calls `createProduct`).
- Embedding-sync failures during product create/update/delete must be **logged and swallowed**, never fail the product operation itself.
- CSV import stays synchronous this sprint — no queue/background infra. Already capped at 1000 rows (Sprint 1 commit `931acc7`).
- RAG endpoint returns retrieval **+ LLM-generated answer** (`gpt-4o-mini`), not retrieval-only.
- Embedding model: `text-embedding-3-small` (1536 dimensions) — every vector column and literal in this plan assumes this exact dimension.
- **One** unified `KnowledgeChunk` table for all source types (matches PRD §16.2's single metadata schema) — never split by source type.
- No ivfflat/hnsw vector index this sprint — data volume is small; sequential scan is fine.
- `embedding` is declared `Unsupported("vector(1536)")?` (nullable) in Prisma — Prisma has no native vector type, so all inserts/updates to it and all similarity search go through raw SQL (`$executeRaw`/`$queryRaw`), never the typed Prisma Client API for that column.
- The OpenAI client in `src/lib/ai/*` must be constructed **lazily** (on first actual call), not at module top-level — constructing eagerly makes the module throw at import time if `OPENAI_API_KEY` is unset, which would risk breaking `npm run build`/route bundling. This mirrors why `src/lib/db/prisma.ts` doesn't eagerly connect either.
- TypeScript strict mode; no `any` in production code (tests may use `as any` for fake data, matching the existing Sprint 1 test convention).
- UI copy in Turkish, code identifiers in English, commit messages in English.
- Package manager: npm.
- `npm run dev`/`npm run build` already force `--webpack` (Turbopack panics on this project's multi-byte path) — keep using the npm scripts as-is.
- `OPENAI_API_KEY` must be added to `.env.local` (not committed) before any task that makes a real OpenAI call can be manually verified — see Task 2, Step 1.

---

## File Structure

```
prisma/
  schema.prisma                          # modified: + KnowledgeSourceType enum, KnowledgeDocument, KnowledgeChunk

.env.example                             # modified: + OPENAI_API_KEY
package.json                             # modified: + openai dependency

src/
  lib/
    ai/
      embedding.ts                       # generateEmbedding(text) -> number[]
      chat.ts                            # generateGroundedAnswer(question, context) -> string
    knowledge/
      chunking.ts                        # chunkText(text, maxChars?) -> string[]
    validation/
      knowledge.ts                       # createKnowledgeDocumentSchema, updateKnowledgeDocumentSchema
      rag.ts                             # ragQuerySchema
    services/
      knowledge-service.ts               # KnowledgeDocument CRUD + syncProductChunks/deleteProductChunks
      product-service.ts                 # modified: calls knowledge-service sync hooks
      rag-service.ts                     # queryKnowledge(storeId, question, topK?)
  app/
    api/
      knowledge/
        route.ts                         # GET (list) / POST (create)
        [documentId]/route.ts            # GET / PATCH / DELETE
      rag/
        query/route.ts                   # POST { question } -> { answer, sources }
    admin/
      knowledge/
        page.tsx                         # document list + add form + "Soru Sor" test box

tests/
  lib/
    ai/
      embedding.test.ts
      chat.test.ts
    knowledge/
      chunking.test.ts
    services/
      knowledge-service.test.ts
      rag-service.test.ts
      product-service.test.ts            # modified: + sync-hook assertions
```

---

### Task 1: Prisma Şema — pgvector Extension + Knowledge Modelleri

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_knowledge_and_vector/` (generated by the CLI)

**Interfaces:**
- Produces: `KnowledgeSourceType` enum (`PRODUCT | FAQ | SHIPPING_POLICY | RETURN_POLICY | WARRANTY | CAMPAIGN | BLOG | CUSTOM`), `KnowledgeDocument` and `KnowledgeChunk` Prisma models, a `knowledge_chunks` table with a pgvector `embedding` column — consumed by every later task.

- [ ] **Step 1: Add the extension declaration and new models to the schema**

Edit `prisma/schema.prisma`. Change the `generator` and `datasource` blocks:

```prisma
generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  extensions = [vector]
}
```

Append these to the end of the file (after `ProductVariant`):

```prisma
enum KnowledgeSourceType {
  PRODUCT
  FAQ
  SHIPPING_POLICY
  RETURN_POLICY
  WARRANTY
  CAMPAIGN
  BLOG
  CUSTOM
}

model KnowledgeDocument {
  id         String              @id @default(cuid())
  storeId    String
  sourceType KnowledgeSourceType
  title      String
  content    String
  language   String              @default("tr")
  createdAt  DateTime            @default(now())
  updatedAt  DateTime            @updatedAt

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId])
  @@map("knowledge_documents")
}

model KnowledgeChunk {
  id         String              @id @default(cuid())
  storeId    String
  sourceType KnowledgeSourceType
  sourceId   String
  productId  String?
  categoryId String?
  language   String              @default("tr")
  chunkIndex Int                 @default(0)
  content    String
  embedding  Unsupported("vector(1536)")?
  createdAt  DateTime            @default(now())

  @@index([storeId])
  @@index([sourceId])
  @@map("knowledge_chunks")
}
```

Also add the reverse relation field to the existing `Store` model (next to `products Product[]`):

```prisma
  knowledgeDocuments KnowledgeDocument[]
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add_knowledge_and_vector`

Expected: Prisma generates a new migration under `prisma/migrations/`, applies it against `DIRECT_URL`, prints `Your database is now in sync with your schema.`, and regenerates the client.

If it fails with a permission error creating the `vector` extension, run this once in the Supabase SQL editor, then re-run the command above:

```sql
create extension if not exists vector;
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add pgvector extension and knowledge document/chunk models"
```

---

### Task 2: OpenAI Embedding Servisi (TDD)

**Files:**
- Modify: `package.json` (add `openai`)
- Create: `src/lib/ai/embedding.ts`
- Test: `tests/lib/ai/embedding.test.ts`

**Interfaces:**
- Consumes: `process.env.OPENAI_API_KEY`.
- Produces: `EMBEDDING_MODEL: string`, `generateEmbedding(text: string): Promise<number[]>` — consumed by `knowledge-service.ts` (Task 5) and `rag-service.ts` (Task 7).

- [ ] **Step 1: Install the OpenAI SDK and add the env var**

```bash
npm install openai
```

Append to `.env.example`:

```
OPENAI_API_KEY="sk-replace-with-your-openai-api-key"
```

Add the same line with your real key to `.env.local` (not committed) — every later task's manual verification depends on this.

- [ ] **Step 2: Write the failing test**

Create `tests/lib/ai/embedding.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEmbeddingsCreate } = vi.hoisted(() => ({
  mockEmbeddingsCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

import { generateEmbedding, EMBEDDING_MODEL } from "@/lib/ai/embedding";

beforeEach(() => {
  mockEmbeddingsCreate.mockReset();
});

describe("generateEmbedding", () => {
  it("returns the embedding vector from the OpenAI response", async () => {
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });

    const result = await generateEmbedding("test metni");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: "test metni",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/lib/ai/embedding.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/embedding'`

- [ ] **Step 4: Implement**

Create `src/lib/ai/embedding.ts`:

```typescript
import OpenAI from "openai";

// Constructed lazily (only when generateEmbedding is first called), not at
// module load time - the OpenAI SDK throws in its constructor if the API
// key is missing, and eager construction would make importing this module
// (e.g. during route bundling / npm run build) fail if OPENAI_API_KEY isn't
// set in that environment.
let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/lib/ai/embedding.test.ts`
Expected: 1 passed

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/embedding.ts tests/lib/ai/embedding.test.ts package.json package-lock.json .env.example
git commit -m "feat: add OpenAI embedding service"
```

---

### Task 3: OpenAI Grounded Answer (Chat) Servisi (TDD)

**Files:**
- Create: `src/lib/ai/chat.ts`
- Test: `tests/lib/ai/chat.test.ts`

**Interfaces:**
- Consumes: `process.env.OPENAI_API_KEY`.
- Produces: `CHAT_MODEL: string`, `generateGroundedAnswer(question: string, context: string): Promise<string>` — consumed by `rag-service.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/chat.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockChatCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
  })),
}));

import { generateGroundedAnswer, CHAT_MODEL } from "@/lib/ai/chat";

beforeEach(() => {
  mockChatCreate.mockReset();
});

describe("generateGroundedAnswer", () => {
  it("returns the model's answer built from the given context", async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: "Kargonuz 2-3 iş günü içinde teslim edilir." } }],
    });

    const result = await generateGroundedAnswer(
      "Kargo ne zaman gelir?",
      "Kargo 2-3 iş günü içinde teslim edilir.",
    );

    expect(result).toBe("Kargonuz 2-3 iş günü içinde teslim edilir.");
    expect(mockChatCreate).toHaveBeenCalledWith(expect.objectContaining({ model: CHAT_MODEL }));
  });

  it("falls back to a fixed message when the model returns no content", async () => {
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: null } }] });

    const result = await generateGroundedAnswer("Soru", "Bağlam");

    expect(result).toBe("Bu konuda elimde bilgi yok.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/ai/chat.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/chat'`

- [ ] **Step 3: Implement**

Create `src/lib/ai/chat.ts`:

```typescript
import OpenAI from "openai";

// Lazily constructed - see the identical comment in src/lib/ai/embedding.ts.
let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export const CHAT_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT =
  'Sen bir e-ticaret mağazasının müşteri destek asistanısın. Sadece sana verilen bağlam içindeki bilgilere dayanarak Türkçe cevap ver. Bağlamda cevap yoksa, "Bu konuda elimde bilgi yok." de. Bağlamda olmayan fiyat, stok veya politika bilgisi uydurma.';

const FALLBACK_ANSWER = "Bu konuda elimde bilgi yok.";

export async function generateGroundedAnswer(question: string, context: string): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Bağlam:\n${context}\n\nSoru: ${question}` },
    ],
  });
  return response.choices[0]?.message?.content ?? FALLBACK_ANSWER;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/ai/chat.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat.ts tests/lib/ai/chat.test.ts
git commit -m "feat: add OpenAI grounded-answer chat service"
```

---

### Task 4: Chunking Utility (TDD)

**Files:**
- Create: `src/lib/knowledge/chunking.ts`
- Test: `tests/lib/knowledge/chunking.test.ts`

**Interfaces:**
- Produces: `chunkText(text: string, maxChars?: number): string[]` — pure function, consumed by `knowledge-service.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/knowledge/chunking.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/knowledge/chunking";

describe("chunkText", () => {
  it("returns short text as a single chunk", () => {
    const result = chunkText("Kısa metin.", 100);
    expect(result).toEqual(["Kısa metin."]);
  });

  it("combines short paragraphs that fit within maxChars", () => {
    const text = "Birinci paragraf.\n\nIkinci paragraf.";
    const result = chunkText(text, 100);
    expect(result).toEqual(["Birinci paragraf.\n\nIkinci paragraf."]);
  });

  it("starts a new chunk once maxChars would be exceeded", () => {
    const text = `${"a".repeat(10)}\n\n${"b".repeat(10)}\n\n${"c".repeat(10)}`;
    const result = chunkText(text, 15);
    expect(result).toEqual(["a".repeat(10), "b".repeat(10), "c".repeat(10)]);
  });

  it("hard-splits a single paragraph longer than maxChars", () => {
    const text = "x".repeat(25);
    const result = chunkText(text, 10);
    expect(result).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/knowledge/chunking.test.ts`
Expected: FAIL — `Cannot find module '@/lib/knowledge/chunking'`

- [ ] **Step 3: Implement**

Create `src/lib/knowledge/chunking.ts`:

```typescript
export function chunkText(text: string, maxChars = 1000): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
    } else {
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/knowledge/chunking.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/knowledge/chunking.ts tests/lib/knowledge/chunking.test.ts
git commit -m "feat: add paragraph-aware text chunking utility"
```

---

### Task 5: Knowledge Servisi (CRUD) + API Rotaları (TDD)

**Files:**
- Create: `src/lib/validation/knowledge.ts`
- Create: `src/lib/services/knowledge-service.ts`
- Test: `tests/lib/services/knowledge-service.test.ts`
- Create: `src/app/api/knowledge/route.ts`
- Create: `src/app/api/knowledge/[documentId]/route.ts`

**Interfaces:**
- Consumes: `prisma` (existing `src/lib/db/prisma.ts`), `generateEmbedding` (Task 2), `chunkText` (Task 4), `ProductWithVariants` (existing `product-service.ts`), tenant session pattern from Sprint 1 Task 7.
- Produces: `createKnowledgeDocument(storeId, input): Promise<KnowledgeDocument>`, `listKnowledgeDocuments(storeId): Promise<KnowledgeDocument[]>`, `getKnowledgeDocumentById(storeId, id): Promise<KnowledgeDocument | null>`, `updateKnowledgeDocument(storeId, id, input): Promise<KnowledgeDocument>`, `deleteKnowledgeDocument(storeId, id): Promise<void>`, `syncProductChunks(storeId, product: ProductWithVariants): Promise<void>`, `deleteProductChunks(storeId, productId): Promise<void>` — the last two consumed by `product-service.ts` in Task 6; `queryKnowledge` in Task 7 reads the `knowledge_chunks` table this task writes to.

- [ ] **Step 1: Write the validation schemas**

Create `src/lib/validation/knowledge.ts`:

```typescript
import { z } from "zod";

// PRODUCT is intentionally excluded - product chunks are only ever
// auto-synced from product-service.ts, never entered manually here.
export const knowledgeSourceTypeValues = [
  "FAQ",
  "SHIPPING_POLICY",
  "RETURN_POLICY",
  "WARRANTY",
  "CAMPAIGN",
  "BLOG",
  "CUSTOM",
] as const;

export const createKnowledgeDocumentSchema = z.object({
  sourceType: z.enum(knowledgeSourceTypeValues),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
});

export type CreateKnowledgeDocumentInput = z.infer<typeof createKnowledgeDocumentSchema>;

export const updateKnowledgeDocumentSchema = createKnowledgeDocumentSchema.partial();

export type UpdateKnowledgeDocumentInput = z.infer<typeof updateKnowledgeDocumentSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/services/knowledge-service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateEmbedding } from "@/lib/ai/embedding";
import {
  createKnowledgeDocument,
  listKnowledgeDocuments,
  getKnowledgeDocumentById,
  updateKnowledgeDocument,
  deleteKnowledgeDocument,
  syncProductChunks,
  deleteProductChunks,
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
  generateEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
  prismaMock.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.knowledgeChunk.create.mockResolvedValue({ id: "chunk_1" } as any);
});

describe("createKnowledgeDocument", () => {
  it("creates the document and embeds its content as chunks", async () => {
    const fakeDocument = {
      id: "doc_1",
      storeId: "store_1",
      sourceType: "FAQ",
      title: "Kargo süresi",
      content: "Kargo 2-3 iş günü içinde teslim edilir.",
    } as any;
    prismaMock.knowledgeDocument.create.mockResolvedValue(fakeDocument);

    const result = await createKnowledgeDocument("store_1", {
      sourceType: "FAQ",
      title: "Kargo süresi",
      content: "Kargo 2-3 iş günü içinde teslim edilir.",
    });

    expect(result).toEqual(fakeDocument);
    expect(prismaMock.knowledgeDocument.create).toHaveBeenCalledWith({
      data: {
        storeId: "store_1",
        sourceType: "FAQ",
        title: "Kargo süresi",
        content: "Kargo 2-3 iş günü içinde teslim edilir.",
      },
    });
    expect(generateEmbeddingMock).toHaveBeenCalledWith("Kargo 2-3 iş günü içinde teslim edilir.");
    expect(prismaMock.knowledgeChunk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: "store_1",
          sourceType: "FAQ",
          sourceId: "doc_1",
          chunkIndex: 0,
          content: "Kargo 2-3 iş günü içinde teslim edilir.",
        }),
      }),
    );
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe("listKnowledgeDocuments", () => {
  it("only queries documents for the given storeId", async () => {
    prismaMock.knowledgeDocument.findMany.mockResolvedValue([]);

    await listKnowledgeDocuments("store_1");

    expect(prismaMock.knowledgeDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: "store_1" } }),
    );
  });
});

describe("getKnowledgeDocumentById", () => {
  it("returns null when the document belongs to a different store", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue(null);

    const result = await getKnowledgeDocumentById("store_1", "doc_from_other_store");

    expect(result).toBeNull();
  });
});

describe("updateKnowledgeDocument", () => {
  it("throws when the document does not belong to the store", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue(null);

    await expect(updateKnowledgeDocument("store_1", "missing", { title: "Yeni" })).rejects.toThrow(
      "Bilgi dokümanı bulunamadı.",
    );
  });

  it("re-embeds chunks from the updated content", async () => {
    const existing = {
      id: "doc_1",
      storeId: "store_1",
      sourceType: "FAQ",
      title: "Eski",
      content: "Eski içerik",
    } as any;
    const updated = { ...existing, content: "Yeni içerik" };
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue(existing);
    prismaMock.knowledgeDocument.update.mockResolvedValue(updated);

    const result = await updateKnowledgeDocument("store_1", "doc_1", { content: "Yeni içerik" });

    expect(result).toEqual(updated);
    expect(prismaMock.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { storeId: "store_1", sourceId: "doc_1" },
    });
    expect(generateEmbeddingMock).toHaveBeenCalledWith("Yeni içerik");
  });
});

describe("deleteKnowledgeDocument", () => {
  it("throws when the document does not belong to the store", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue(null);

    await expect(deleteKnowledgeDocument("store_1", "missing")).rejects.toThrow(
      "Bilgi dokümanı bulunamadı.",
    );
  });

  it("deletes the document and its chunks", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue({ id: "doc_1", storeId: "store_1" } as any);
    prismaMock.knowledgeDocument.delete.mockResolvedValue({} as any);

    await deleteKnowledgeDocument("store_1", "doc_1");

    expect(prismaMock.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { storeId: "store_1", sourceId: "doc_1" },
    });
    expect(prismaMock.knowledgeDocument.delete).toHaveBeenCalledWith({ where: { id: "doc_1" } });
  });
});

describe("syncProductChunks", () => {
  it("embeds a combined product text as a single chunk", async () => {
    const product = {
      id: "product_1",
      storeId: "store_1",
      title: "Koltuk Takımı",
      description: "Rahat oturum",
      brand: "Ikea",
      categoryId: "mobilya",
      variants: [{ price: 1999.99, currency: "TRY" }],
    } as any;

    await syncProductChunks("store_1", product);

    expect(prismaMock.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { storeId: "store_1", sourceId: "product_1" },
    });
    expect(prismaMock.knowledgeChunk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: "store_1",
          sourceType: "PRODUCT",
          sourceId: "product_1",
          productId: "product_1",
          chunkIndex: 0,
        }),
      }),
    );
  });
});

describe("deleteProductChunks", () => {
  it("deletes all chunks for the product", async () => {
    await deleteProductChunks("store_1", "product_1");

    expect(prismaMock.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { storeId: "store_1", sourceId: "product_1" },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/lib/services/knowledge-service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/knowledge-service'`

- [ ] **Step 4: Implement**

Create `src/lib/services/knowledge-service.ts`:

```typescript
import type { KnowledgeDocument, KnowledgeSourceType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateEmbedding } from "@/lib/ai/embedding";
import { chunkText } from "@/lib/knowledge/chunking";
import type { ProductWithVariants } from "@/lib/services/product-service";
import type {
  CreateKnowledgeDocumentInput,
  UpdateKnowledgeDocumentInput,
} from "@/lib/validation/knowledge";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

async function replaceChunks(
  storeId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
  productId: string | null,
  chunks: string[],
): Promise<void> {
  await prisma.knowledgeChunk.deleteMany({ where: { storeId, sourceId } });

  for (let index = 0; index < chunks.length; index += 1) {
    const content = chunks[index];
    const embedding = await generateEmbedding(content);

    const created = await prisma.knowledgeChunk.create({
      data: { storeId, sourceType, sourceId, productId, chunkIndex: index, content },
    });

    await prisma.$executeRaw`
      UPDATE knowledge_chunks
      SET embedding = ${toVectorLiteral(embedding)}::vector
      WHERE id = ${created.id}
    `;
  }
}

export async function createKnowledgeDocument(
  storeId: string,
  input: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  const document = await prisma.knowledgeDocument.create({
    data: { storeId, sourceType: input.sourceType, title: input.title, content: input.content },
  });

  await replaceChunks(storeId, input.sourceType, document.id, null, chunkText(input.content));

  return document;
}

export async function listKnowledgeDocuments(storeId: string): Promise<KnowledgeDocument[]> {
  return prisma.knowledgeDocument.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getKnowledgeDocumentById(
  storeId: string,
  id: string,
): Promise<KnowledgeDocument | null> {
  return prisma.knowledgeDocument.findFirst({ where: { id, storeId } });
}

export async function updateKnowledgeDocument(
  storeId: string,
  id: string,
  input: UpdateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  const existing = await prisma.knowledgeDocument.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw new Error("Bilgi dokümanı bulunamadı.");
  }

  const document = await prisma.knowledgeDocument.update({
    where: { id },
    data: {
      sourceType: input.sourceType,
      title: input.title,
      content: input.content,
    },
  });

  await replaceChunks(storeId, document.sourceType, document.id, null, chunkText(document.content));

  return document;
}

export async function deleteKnowledgeDocument(storeId: string, id: string): Promise<void> {
  const existing = await prisma.knowledgeDocument.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw new Error("Bilgi dokümanı bulunamadı.");
  }
  await prisma.knowledgeChunk.deleteMany({ where: { storeId, sourceId: id } });
  await prisma.knowledgeDocument.delete({ where: { id } });
}

function buildProductText(product: ProductWithVariants): string {
  const parts = [product.title];
  if (product.brand) {
    parts.push(`Marka: ${product.brand}`);
  }
  if (product.categoryId) {
    parts.push(`Kategori: ${product.categoryId}`);
  }
  if (product.description) {
    parts.push(product.description);
  }
  if (product.variants.length > 0) {
    const prices = product.variants.map((variant) => `${variant.price} ${variant.currency}`).join(", ");
    parts.push(`Fiyat: ${prices}`);
  }
  return parts.join("\n\n");
}

export async function syncProductChunks(
  storeId: string,
  product: ProductWithVariants,
): Promise<void> {
  const text = buildProductText(product);
  await replaceChunks(storeId, "PRODUCT", product.id, product.id, chunkText(text));
}

export async function deleteProductChunks(storeId: string, productId: string): Promise<void> {
  await prisma.knowledgeChunk.deleteMany({ where: { storeId, sourceId: productId } });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/lib/services/knowledge-service.test.ts`
Expected: 9 passed

- [ ] **Step 6: Write the API routes**

Create `src/app/api/knowledge/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import { createKnowledgeDocument, listKnowledgeDocuments } from "@/lib/services/knowledge-service";
import { createKnowledgeDocumentSchema } from "@/lib/validation/knowledge";

async function requireSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }
  try {
    const documents = await listKnowledgeDocuments(session.storeId);
    return NextResponse.json({ documents });
  } catch {
    return NextResponse.json(
      { error: "Bilgi dokümanları getirilemedi, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createKnowledgeDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const document = await createKnowledgeDocument(session.storeId, parsed.data);
    return NextResponse.json({ document }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Bilgi dokümanı oluşturulamadı, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
```

Create `src/app/api/knowledge/[documentId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import {
  getKnowledgeDocumentById,
  updateKnowledgeDocument,
  deleteKnowledgeDocument,
} from "@/lib/services/knowledge-service";
import { updateKnowledgeDocumentSchema } from "@/lib/validation/knowledge";

async function requireSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : null;
}

type RouteParams = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { documentId } = await params;
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }
  const document = await getKnowledgeDocumentById(session.storeId, documentId);
  if (!document) {
    return NextResponse.json({ error: "Bilgi dokümanı bulunamadı." }, { status: 404 });
  }
  return NextResponse.json({ document });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { documentId } = await params;
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = updateKnowledgeDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const document = await updateKnowledgeDocument(session.storeId, documentId, parsed.data);
    return NextResponse.json({ document });
  } catch {
    return NextResponse.json({ error: "Bilgi dokümanı bulunamadı." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { documentId } = await params;
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  try {
    await deleteKnowledgeDocument(session.storeId, documentId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bilgi dokümanı bulunamadı." }, { status: 404 });
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/knowledge.ts src/lib/services/knowledge-service.ts tests/lib/services/knowledge-service.test.ts src/app/api/knowledge
git commit -m "feat: add knowledge document service and tenant-scoped API routes"
```

---

### Task 6: Ürün Servisine Embedding Senkron Entegrasyonu (TDD)

**Files:**
- Modify: `src/lib/services/product-service.ts`
- Modify: `tests/lib/services/product-service.test.ts`

**Interfaces:**
- Consumes: `syncProductChunks`, `deleteProductChunks` (Task 5).
- Produces: no new exports — `createProduct`/`updateProduct`/`deleteProduct` keep their existing signatures, but now also sync the product's knowledge chunks as a non-fatal side effect.

- [ ] **Step 1: Write the failing tests**

Open `tests/lib/services/product-service.test.ts` and replace its full contents with:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from "@/lib/services/product-service";
import { syncProductChunks, deleteProductChunks } from "@/lib/services/knowledge-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/lib/services/knowledge-service", () => ({
  syncProductChunks: vi.fn(),
  deleteProductChunks: vi.fn(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const syncProductChunksMock = vi.mocked(syncProductChunks);
const deleteProductChunksMock = vi.mocked(deleteProductChunks);

beforeEach(() => {
  mockReset(prismaMock);
  syncProductChunksMock.mockReset();
  deleteProductChunksMock.mockReset();
  syncProductChunksMock.mockResolvedValue(undefined);
  deleteProductChunksMock.mockResolvedValue(undefined);
});

describe("createProduct", () => {
  it("creates a product scoped to storeId with nested variants", async () => {
    const fakeProduct = { id: "product_1", storeId: "store_1", title: "Koltuk", variants: [] } as any;
    prismaMock.product.create.mockResolvedValue(fakeProduct);

    const result = await createProduct("store_1", {
      title: "Koltuk",
      variants: [{ price: 1999.99, stockQuantity: 5 }],
    });

    expect(result).toEqual(fakeProduct);
    expect(prismaMock.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: "store_1",
          title: "Koltuk",
          variants: { create: [{ price: 1999.99, stockQuantity: 5 }] },
        }),
      }),
    );
    expect(syncProductChunksMock).toHaveBeenCalledWith("store_1", fakeProduct);
  });

  it("does not throw when knowledge sync fails", async () => {
    const fakeProduct = { id: "product_1", storeId: "store_1", title: "Koltuk", variants: [] } as any;
    prismaMock.product.create.mockResolvedValue(fakeProduct);
    syncProductChunksMock.mockRejectedValue(new Error("embedding down"));

    await expect(
      createProduct("store_1", { title: "Koltuk", variants: [{ price: 1999.99, stockQuantity: 5 }] }),
    ).resolves.toEqual(fakeProduct);
  });
});

describe("listProducts", () => {
  it("only queries products for the given storeId", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts("store_1");

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: "store_1" } }),
    );
  });
});

describe("getProductById", () => {
  it("returns null when the product belongs to a different store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    const result = await getProductById("store_1", "product_from_other_store");

    expect(result).toBeNull();
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "product_from_other_store", storeId: "store_1" } }),
    );
  });
});

describe("updateProduct", () => {
  it("throws when the product does not belong to the store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expect(updateProduct("store_1", "missing", { title: "Yeni" })).rejects.toThrow(
      "Ürün bulunamadı.",
    );
  });

  it("syncs knowledge chunks after a successful update", async () => {
    const existing = { id: "product_1", storeId: "store_1" } as any;
    const updated = { id: "product_1", storeId: "store_1", title: "Yeni", variants: [] } as any;
    prismaMock.product.findFirst.mockResolvedValue(existing);
    prismaMock.product.update.mockResolvedValue(updated);

    const result = await updateProduct("store_1", "product_1", { title: "Yeni" });

    expect(result).toEqual(updated);
    expect(syncProductChunksMock).toHaveBeenCalledWith("store_1", updated);
  });
});

describe("deleteProduct", () => {
  it("throws when the product does not belong to the store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expect(deleteProduct("store_1", "missing")).rejects.toThrow("Ürün bulunamadı.");
  });

  it("deletes the product's knowledge chunks after a successful delete", async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: "product_1", storeId: "store_1" } as any);
    prismaMock.product.delete.mockResolvedValue({} as any);

    await deleteProduct("store_1", "product_1");

    expect(deleteProductChunksMock).toHaveBeenCalledWith("store_1", "product_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/services/product-service.test.ts`
Expected: FAIL — new assertions fail because `product-service.ts` doesn't call `syncProductChunks`/`deleteProductChunks` yet.

- [ ] **Step 3: Implement**

Replace the full contents of `src/lib/services/product-service.ts`:

```typescript
import type { Product, ProductVariant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { CreateProductInput, UpdateProductInput } from "@/lib/validation/product";
import { syncProductChunks, deleteProductChunks } from "@/lib/services/knowledge-service";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

async function syncKnowledgeSafely(storeId: string, product: ProductWithVariants): Promise<void> {
  try {
    await syncProductChunks(storeId, product);
  } catch (error) {
    console.error("Ürün bilgi tabanına eklenemedi:", error);
  }
}

async function deleteKnowledgeSafely(storeId: string, productId: string): Promise<void> {
  try {
    await deleteProductChunks(storeId, productId);
  } catch (error) {
    console.error("Ürün bilgi tabanından silinemedi:", error);
  }
}

export async function createProduct(
  storeId: string,
  input: CreateProductInput,
): Promise<ProductWithVariants> {
  const product = await prisma.product.create({
    data: {
      storeId,
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      brand: input.brand,
      url: input.url,
      imageUrl: input.imageUrl,
      variants: { create: input.variants },
    },
    include: { variants: true },
  });

  await syncKnowledgeSafely(storeId, product);

  return product;
}

export async function listProducts(storeId: string): Promise<ProductWithVariants[]> {
  return prisma.product.findMany({
    where: { storeId },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProductById(
  storeId: string,
  productId: string,
): Promise<ProductWithVariants | null> {
  return prisma.product.findFirst({
    where: { id: productId, storeId },
    include: { variants: true },
  });
}

export async function updateProduct(
  storeId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductWithVariants> {
  const existing = await prisma.product.findFirst({ where: { id: productId, storeId } });
  if (!existing) {
    throw new Error("Ürün bulunamadı.");
  }

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      brand: input.brand,
      url: input.url,
      imageUrl: input.imageUrl,
    },
    include: { variants: true },
  });

  await syncKnowledgeSafely(storeId, product);

  return product;
}

export async function deleteProduct(storeId: string, productId: string): Promise<void> {
  const existing = await prisma.product.findFirst({ where: { id: productId, storeId } });
  if (!existing) {
    throw new Error("Ürün bulunamadı.");
  }
  await prisma.product.delete({ where: { id: productId } });
  await deleteKnowledgeSafely(storeId, productId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/services/product-service.test.ts`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/product-service.ts tests/lib/services/product-service.test.ts
git commit -m "feat: sync product knowledge chunks on create/update/delete"
```

---

### Task 7: RAG Servisi + API Rotası (TDD)

**Files:**
- Create: `src/lib/validation/rag.ts`
- Create: `src/lib/services/rag-service.ts`
- Test: `tests/lib/services/rag-service.test.ts`
- Create: `src/app/api/rag/query/route.ts`

**Interfaces:**
- Consumes: `prisma`, `generateEmbedding` (Task 2), `generateGroundedAnswer` (Task 3).
- Produces: `type RagSource = { sourceType: KnowledgeSourceType; sourceId: string; content: string }`, `type RagResult = { answer: string; sources: RagSource[] }`, `queryKnowledge(storeId: string, question: string, topK?: number): Promise<RagResult>`.

- [ ] **Step 1: Write the validation schema**

Create `src/lib/validation/rag.ts`:

```typescript
import { z } from "zod";

export const ragQuerySchema = z.object({
  question: z.string().min(1).max(2000),
});

export type RagQueryInput = z.infer<typeof ragQuerySchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/services/rag-service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateEmbedding } from "@/lib/ai/embedding";
import { generateGroundedAnswer } from "@/lib/ai/chat";
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
});

describe("queryKnowledge", () => {
  it("returns a fixed answer without calling the LLM when the store has no chunks", async () => {
    prismaMock.knowledgeChunk.count.mockResolvedValue(0);

    const result = await queryKnowledge("store_1", "Kargo ne zaman gelir?");

    expect(result.sources).toEqual([]);
    expect(result.answer).toContain("Henüz");
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("retrieves the nearest chunks and returns a grounded answer", async () => {
    prismaMock.knowledgeChunk.count.mockResolvedValue(2);
    generateEmbeddingMock.mockResolvedValue([0.1, 0.2]);
    prismaMock.$queryRaw.mockResolvedValue([
      { sourceType: "FAQ", sourceId: "doc_1", content: "Kargo 2-3 iş günü sürer." },
    ] as any);
    generateGroundedAnswerMock.mockResolvedValue("Kargonuz 2-3 iş günü içinde teslim edilir.");

    const result = await queryKnowledge("store_1", "Kargo ne zaman gelir?", 3);

    expect(generateEmbeddingMock).toHaveBeenCalledWith("Kargo ne zaman gelir?");
    expect(generateGroundedAnswerMock).toHaveBeenCalledWith(
      "Kargo ne zaman gelir?",
      "Kargo 2-3 iş günü sürer.",
    );
    expect(result).toEqual({
      answer: "Kargonuz 2-3 iş günü içinde teslim edilir.",
      sources: [{ sourceType: "FAQ", sourceId: "doc_1", content: "Kargo 2-3 iş günü sürer." }],
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/lib/services/rag-service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/rag-service'`

- [ ] **Step 4: Implement**

Create `src/lib/services/rag-service.ts`:

```typescript
import type { KnowledgeSourceType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateEmbedding } from "@/lib/ai/embedding";
import { generateGroundedAnswer } from "@/lib/ai/chat";

export type RagSource = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  content: string;
};

export type RagResult = {
  answer: string;
  sources: RagSource[];
};

const NO_KNOWLEDGE_ANSWER =
  "Henüz bu mağaza için bilgi eklenmemiş, bu soruyu şu an cevaplayamıyorum.";
const DEFAULT_TOP_K = 5;

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function queryKnowledge(
  storeId: string,
  question: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RagResult> {
  const totalChunks = await prisma.knowledgeChunk.count({ where: { storeId } });
  if (totalChunks === 0) {
    return { answer: NO_KNOWLEDGE_ANSWER, sources: [] };
  }

  const questionEmbedding = await generateEmbedding(question);
  const vectorLiteral = toVectorLiteral(questionEmbedding);

  const rows = await prisma.$queryRaw<RagSource[]>`
    SELECT source_type as "sourceType", source_id as "sourceId", content
    FROM knowledge_chunks
    WHERE store_id = ${storeId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `;

  const context = rows.map((row) => row.content).join("\n\n---\n\n");
  const answer = await generateGroundedAnswer(question, context);

  return { answer, sources: rows };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/lib/services/rag-service.test.ts`
Expected: 2 passed

- [ ] **Step 6: Write the API route**

Create `src/app/api/rag/query/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import { queryKnowledge } from "@/lib/services/rag-service";
import { ragQuerySchema } from "@/lib/validation/rag";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = ragQuerySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await queryKnowledge(session.storeId, parsed.data.question);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Şu anda cevap oluşturulamadı, lütfen tekrar deneyin." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/rag.ts src/lib/services/rag-service.ts tests/lib/services/rag-service.test.ts src/app/api/rag
git commit -m "feat: add RAG query service and API route"
```

---

### Task 8: Admin UI — Bilgi Tabanı Sayfası

**Files:**
- Create: `src/app/admin/knowledge/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/knowledge` (Task 5), `POST /api/rag/query` (Task 7).

- [ ] **Step 1: Write the knowledge page**

Create `src/app/admin/knowledge/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type SourceType =
  | "FAQ"
  | "SHIPPING_POLICY"
  | "RETURN_POLICY"
  | "WARRANTY"
  | "CAMPAIGN"
  | "BLOG"
  | "CUSTOM";

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  FAQ: "SSS",
  SHIPPING_POLICY: "Kargo Politikası",
  RETURN_POLICY: "İade Politikası",
  WARRANTY: "Garanti",
  CAMPAIGN: "Kampanya",
  BLOG: "Blog / Rehber",
  CUSTOM: "Özel Not",
};

type KnowledgeDocument = {
  id: string;
  sourceType: SourceType;
  title: string;
  updatedAt: string;
};

type RagSource = { sourceType: SourceType; sourceId: string; content: string };

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sourceType, setSourceType] = useState<SourceType>("FAQ");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<RagSource[]>([]);
  const [isAsking, setIsAsking] = useState(false);

  async function loadDocuments() {
    const response = await fetch("/api/knowledge");
    const data = await response.json();
    setDocuments(data.documents ?? []);
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function handleAddDocument(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType, title, content }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(JSON.stringify(data.error));
      return;
    }

    setTitle("");
    setContent("");
    await loadDocuments();
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    setAnswer(null);
    setSources([]);
    setIsAsking(true);

    const response = await fetch("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    const data = await response.json();
    setIsAsking(false);

    if (!response.ok) {
      setAnswer(typeof data.error === "string" ? data.error : "Bir hata oluştu.");
      return;
    }

    setAnswer(data.answer);
    setSources(data.sources ?? []);
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Bilgi Tabanı</h1>

      <form onSubmit={handleAddDocument} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-sm text-gray-700">Kaynak Tipi</label>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SourceType)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          >
            {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-700">Başlık</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700">İçerik</label>
          <textarea
            required
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <button type="submit" className="rounded bg-gray-900 px-3 py-2 text-white">
          Ekle
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="py-2">Başlık</th>
            <th className="py-2">Tip</th>
            <th className="py-2">Güncellendi</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-b border-gray-100">
              <td className="py-2">{doc.title}</td>
              <td className="py-2">{SOURCE_TYPE_LABELS[doc.sourceType]}</td>
              <td className="py-2">{new Date(doc.updatedAt).toLocaleDateString("tr-TR")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={handleAsk} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-medium">Soru Sor (Test)</h2>
        <input
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Örn: Kargo ne zaman gelir?"
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
        <button
          type="submit"
          disabled={isAsking}
          className="rounded bg-gray-700 px-3 py-2 text-white disabled:opacity-50"
        >
          Sor
        </button>
        {answer && (
          <div className="rounded bg-gray-50 p-3 text-sm">
            <p className="font-medium">{answer}</p>
            {sources.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-gray-600">
                {sources.map((source, index) => (
                  <li key={index}>
                    {SOURCE_TYPE_LABELS[source.sourceType]}: {source.content.slice(0, 80)}...
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

With `npm run dev` running and logged in (from Sprint 1's `/admin/login`):
1. Visit `http://localhost:3000/admin/knowledge`.
2. Add a document: Kaynak Tipi "SSS", Başlık "Kargo süresi", İçerik "Kargo 2-3 iş günü içinde teslim edilir." → it appears in the table.
3. In "Soru Sor (Test)", ask "Kargo ne zaman gelir?" → an answer referencing the 2-3 iş günü content appears, with the FAQ source listed underneath.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/knowledge
git commit -m "feat: add admin knowledge base page with document form and RAG test box"
```

---

### Task 9: Uçtan Uca Doğrulama

**Files:** none (verification only)

- [ ] **Step 1: Confirm `OPENAI_API_KEY` is set**

Check `.env.local` has a real `OPENAI_API_KEY` value (added in Task 2, Step 1) — every step below makes real OpenAI calls.

- [ ] **Step 2: Run the full automated test suite**

Run: `npm test`
Expected: all tests pass (Sprint 1's 22 plus this sprint's new ones — chunking, embedding, chat, knowledge-service, rag-service, plus the extended product-service tests).

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: compiled successfully, TypeScript clean, no lint errors.

- [ ] **Step 4: Manual end-to-end walkthrough**

With `npm run dev` running and a logged-in session from Sprint 1 (or a fresh `/admin/login` register):

1. Add a knowledge document via `/admin/knowledge` (Kargo/İade/SSS metni).
2. Add a product via `/admin/products` → confirm no error is shown (embedding sync runs inline and silently, per the design).
3. On `/admin/knowledge`, ask a question whose answer lives only in the document you added in step 1 → confirm the returned answer is grounded in that content, with a matching source listed.
4. Ask a question whose answer lives only in the product you added in step 2 (e.g. its title or price) → confirm the answer references it.
5. Ask an unrelated question (e.g. "Ayın kaçında bugün?") → confirm the answer says it doesn't know, not a hallucinated fact.
6. Register a second store (store B), confirm `/admin/knowledge`'s question box returns the "Henüz bu mağaza için bilgi eklenmemiş" fallback for store B (tenant isolation — store B has no chunks yet).

Delete the test stores/documents/products from the real DB afterward; stop the dev server.

- [ ] **Step 5: Record what's out of scope for next sprint**

No commit needed — checklist confirmation only. Sprint 3 (PRD §25.5) starts with the chat widget, conversation API, agent orchestration, and product recommendation tool — none of that is touched in Sprint 2.

---

## Self-Review Notes

- **Spec coverage:** design spec's data model (Task 1), embedding client (Task 2), chat client (Task 3), chunking (Task 4), knowledge CRUD + product auto-sync (Tasks 5–6), RAG query (Task 7), admin UI (Task 8) — all covered. Error-handling and testing sections of the spec are folded into each task's implementation and test steps rather than a separate task, matching Sprint 1's convention.
- **Explicitly deferred (matches the design spec's "Out of scope" section):** web scraping/URL ingestion, Ikas sync, BullMQ/queue processing, hybrid search, reranking, vector indexing, `visibility` metadata, chat widget/streaming/conversation state/agent orchestration (Sprint 3).
- **Type consistency check:** `ProductWithVariants` (Sprint 1's `product-service.ts`) is imported by `knowledge-service.ts` via `import type` only — no runtime circular dependency, since `product-service.ts` imports `syncProductChunks`/`deleteProductChunks` from `knowledge-service.ts` at runtime. `RagSource`/`RagResult` (Task 7) are the only types returned by `queryKnowledge`, consumed as-is by the route in the same task and by the admin page in Task 8 (`SOURCE_TYPE_LABELS` in the page covers the same 7 manual source types as `knowledgeSourceTypeValues` in Task 5's validation, deliberately excluding `PRODUCT`).
