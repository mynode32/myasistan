# Sprint 2: Knowledge Ingestion, Embedding, Vector Search, Basit RAG Endpoint — Design

**Status:** Approved for planning
**PRD reference:** `docs/dijital-satis-calisani-saas-urun-dokumani.md` §10.2 (RAG Mimarisi), §16.2 (Vector Metadata), §18.2 (Teknoloji Stack), §25.5 (Sprint 2)
**Builds on:** Sprint 1 (`docs/superpowers/plans/2026-07-24-mvp-sprint1-setup.md`) — auth, tenant-scoped Store/Product CRUD, CSV import, admin panel shell.

## Goal

Give each store a queryable knowledge base: product catalog (auto-synced from existing Product/ProductVariant data) plus manually-entered knowledge documents (FAQ, shipping/return/warranty policy, campaign rules, blog/guide content, custom notes), embedded into pgvector and retrievable through a single RAG query endpoint that returns an LLM-generated, context-grounded answer.

## Scope decisions (confirmed during brainstorming)

- **Source coverage:** full PRD list (product, FAQ, shipping/return/warranty policy, campaign, blog, custom) — all via **manual admin text entry** except product, which is auto-ingested from the existing `Product`/`ProductVariant` tables. No web scraping, no Ikas sync in this sprint (both explicitly out of scope for Sprint 1/2 per PRD).
- **RAG endpoint:** retrieval **+ LLM-generated answer** (not retrieval-only) — validates the real end-to-end experience users will get in Sprint 3's chat widget, without building streaming/conversation state/tool-calling yet.
- **Product embedding trigger:** automatic, inline in `product-service.ts`'s `createProduct`/`updateProduct`/`deleteProduct` — no separate "sync" button. CSV import is covered for free since it already calls `createProduct` per row.
- **CSV import + embedding cost:** left synchronous for this sprint. CSV import is already capped at 1000 rows (Sprint 1 hardening commit `931acc7`); no queue/background infra exists yet and building one is out of scope for "basit" Sprint 2. Embedding failures during product sync must not fail the product create/update/delete itself — logged and swallowed, not surfaced as a request error.

## Data model

Two new Prisma models, added to `prisma/schema.prisma`:

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
  sourceId   String              // productId or knowledgeDocumentId
  productId  String?
  categoryId String?
  language   String              @default("tr")
  chunkIndex Int                 @default(0)
  content    String
  embedding  Unsupported("vector(1536)")
  createdAt  DateTime            @default(now())

  @@index([storeId])
  @@index([sourceId])
  @@map("knowledge_chunks")
}
```

Rationale for one unified `KnowledgeChunk` table (not one table per source type): PRD §16.2 already specifies a single metadata schema (`store_id, source_type, source_id, product_id, category_id, language, visibility, updated_at`) shared across all source types. Splitting by source type would force a UNION across N tables on every RAG query for no benefit. (`visibility` from §16.2 is deferred — no use case for it yet in Sprint 2; add when a real need appears, e.g. draft vs. published knowledge.)

`embedding` is declared `Unsupported("vector(1536)")` because Prisma has no native vector type — this is the standard Prisma+pgvector pattern. All inserts and similarity queries against this column go through raw SQL (`$executeRawUnsafe` / `$queryRaw` with the `<=>` cosine-distance operator), not the generated Prisma Client API.

**Migration requirements:**
- Enable the extension: `CREATE EXTENSION IF NOT EXISTS vector;`
- `generator client` needs `previewFeatures = ["postgresqlExtensions"]`; `datasource db` needs `extensions = [vector]` so `prisma migrate` tracks the extension.
- No ivfflat/hnsw index in this sprint — data volume is small (dev/early-access scale); sequential scan is fine. Note left in code for when this needs revisiting.

**Embedding model:** `text-embedding-3-small` (1536 dimensions) — PRD says "text-embedding-3" without specifying variant; `-small` is the cost/performance-appropriate choice for MVP (§18.5 cost model concerns).
**Chat model for answer generation:** `gpt-4o-mini` — cheap, sufficient for grounded single-turn answers.

## Components

### `src/lib/ai/embedding.ts`
`generateEmbedding(text: string): Promise<number[]>` — thin OpenAI SDK wrapper. Consumes `OPENAI_API_KEY`.

### `src/lib/ai/chat.ts`
`generateGroundedAnswer(question: string, context: string): Promise<string>` — system prompt instructs the model to answer only from the given context, in Turkish, and say it doesn't know if the answer isn't in context. This is the MVP version of PRD §24's "tool sonucu olmadan fiyat/stok iddiasi yapmama" grounding requirement, applied to knowledge content.

### `src/lib/knowledge/chunking.ts`
`chunkText(text: string, maxChars = 1000): string[]` — pure function. Paragraph-aware: accumulates paragraphs (split on blank lines) up to `maxChars`; a single paragraph longer than `maxChars` is hard-split. No overlap, no token-based logic (out of scope — see below).

### `src/lib/services/knowledge-service.ts`
- `createKnowledgeDocument(storeId, input: CreateKnowledgeDocumentInput): Promise<KnowledgeDocument>` — creates the document row, then chunks + embeds + stores its `KnowledgeChunk`s.
- `listKnowledgeDocuments(storeId): Promise<KnowledgeDocument[]>`
- `getKnowledgeDocumentById(storeId, id): Promise<KnowledgeDocument | null>`
- `updateKnowledgeDocument(storeId, id, input: UpdateKnowledgeDocumentInput): Promise<KnowledgeDocument>` — updates the document, deletes its existing chunks, re-chunks + re-embeds.
- `deleteKnowledgeDocument(storeId, id): Promise<void>` — deletes document and its chunks.
- `syncProductChunks(storeId, product: ProductWithVariants): Promise<void>` — builds one combined text (title, description, brand, category, price range) from the product, embeds it as a single chunk, replaces any existing chunks for that `sourceId`.
- `deleteProductChunks(storeId, productId): Promise<void>`

All tenant-scoped by `storeId`, following the Task 7 pattern established in Sprint 1.

### `src/lib/services/product-service.ts` (modified)
`createProduct`, `updateProduct`, `deleteProduct` each call the matching `knowledge-service` sync function after their own DB operation succeeds, wrapped in `try/catch` — a sync/embedding failure is logged (`console.error` or existing logging convention) and does not throw, so the product operation's own success/failure is unaffected.

### `src/lib/services/rag-service.ts`
```ts
queryKnowledge(storeId: string, question: string, topK = 5): Promise<{
  answer: string;
  sources: { sourceType: KnowledgeSourceType; sourceId: string; content: string }[];
}>
```
1. Embed the question.
2. Raw SQL: cosine-distance (`<=>`) nearest `topK` `KnowledgeChunk` rows filtered by `storeId`.
3. Join chunk contents into a single context block.
4. Call `generateGroundedAnswer(question, context)`.
5. Return the answer plus the source chunks used (for admin-side transparency/debugging — not shown to end customers in this sprint).

If zero chunks exist for the store, skip the LLM call and return a fixed "henüz bilgi eklenmemiş" style answer with empty sources — avoids a wasted LLM call and gives a clear signal during manual testing.

## API routes

- `src/app/api/knowledge/route.ts` — `GET` (list), `POST` (create), tenant-scoped via the same session-cookie pattern as Task 7/8 routes.
- `src/app/api/knowledge/[documentId]/route.ts` — `GET`, `PATCH`, `DELETE`.
- `src/app/api/rag/query/route.ts` — `POST { question: string }` → `{ answer, sources }`.

Validation: `src/lib/validation/knowledge.ts` (`createKnowledgeDocumentSchema`, `updateKnowledgeDocumentSchema` — title, content, sourceType enum), `src/lib/validation/rag.ts` (`ragQuerySchema` — question, `min(1).max(2000)`, matching the CSV-import-style bounding precedent from Sprint 1's hardening).

## Admin UI

`src/app/admin/knowledge/page.tsx` — same shape as Sprint 1's products page: list of existing documents (title, source type, updated date), an add form (title, source-type dropdown, content textarea). A small "Soru Sor" test box at the bottom calls `POST /api/rag/query` and displays the answer plus which sources were used — this is how the design gets manually verified end-to-end (no chat widget until Sprint 3).

## Error handling

- Knowledge document routes: same 401 (no/invalid session), 400 (zod validation), 404 (not found / wrong tenant) pattern as Sprint 1's product routes. DB errors caught narrowly per the Sprint 1 hardening commit (`7505647`) precedent — don't mask unrelated errors as generic messages.
- RAG query route: 401 for no session, 400 for empty/oversized question. An OpenAI API failure (rate limit, timeout) surfaces as a 502 with a Turkish user-facing message ("Şu anda cevap oluşturulamadı, lütfen tekrar deneyin.") — not a raw 500.
- Product sync failures (embedding call fails during product create/update/delete): logged, non-fatal, as decided above.

## Testing

Same conventions as Sprint 1: Vitest, `vitest-mock-extended` for Prisma, TDD (failing test → implement → passing).

- `chunkText`: pure-function unit tests (short text → 1 chunk, long text → paragraph-aware split, single oversized paragraph → hard split).
- `knowledge-service`: mocked Prisma + mocked `generateEmbedding`, covering create/update (chunk replacement)/delete.
- `rag-service`: mocked Prisma (`$queryRaw` result) + mocked `generateGroundedAnswer`, covering the zero-chunks short-circuit and the normal retrieval+answer path.
- `product-service`: extend Sprint 1's existing tests to assert the embedding sync call happens after create/update/delete, and that a sync failure doesn't propagate/fail the product operation.
- OpenAI is never called for real in tests — `src/lib/ai/embedding.ts` and `src/lib/ai/chat.ts` are mocked via `vi.mock`.

## Out of scope (explicitly deferred, not gaps)

- Web scraping / URL-based ingestion for blog or category pages (manual text entry only, this sprint).
- Ikas API sync for products/policies.
- Queue/background processing (BullMQ) for embedding — synchronous inline calls only; revisit if CSV import volume becomes a real bottleneck.
- Hybrid search (keyword + structured filters), reranking — PRD §10.2 mentions these for the full agent, not this sprint's "basit" endpoint.
- Chat widget, streaming responses, conversation state, tool-calling, agent orchestration — all Sprint 3 (PRD §25.5).
- `visibility` metadata field from PRD §16.2 — no use case yet, add when needed.
- Vector index (ivfflat/hnsw) tuning — deferred until data volume warrants it.

## Self-review

- **Placeholders:** none — all sections are concrete (file paths, function signatures, model names).
- **Internal consistency:** `KnowledgeChunk.sourceId` doubles as `productId` for product-type chunks (also duplicated into the dedicated `productId` column for direct filtering) and as `KnowledgeDocument.id` for manual-entry types — consistent with the single-table rationale above.
- **Scope:** single sprint, single implementation plan — no further decomposition needed.
- **Ambiguity check:** "basit RAG endpoint" was the one genuinely ambiguous PRD phrase; resolved explicitly above (retrieval + LLM answer, no streaming/conversation state).
