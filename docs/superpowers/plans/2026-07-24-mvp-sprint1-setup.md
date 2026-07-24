# Dijital Satış Çalışanı MVP - Sprint 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js/TypeScript/Prisma foundation for the Dijital Satış Çalışanı SaaS: project scaffold, PostgreSQL schema, JWT-based auth, tenant-scoped Store/Product CRUD, and CSV product import — matching Sprint 1 in the PRD (`dijital-satis-calisani-saas-urun-dokumani.md` §25.5).

**Architecture:** Single Next.js 14+ App Router project (per PRD §18.2/§25.2 "MVP hızlı geliştirme" layout). Thin API routes call small, dependency-free service functions in `src/lib/services/`, which are the unit-tested core. Prisma is the only database access layer, accessed through one singleton client. Auth is custom JWT (signed with `jose`) stored in an httpOnly cookie — no external auth provider.

**Tech Stack:** Next.js 14 (App Router, TypeScript, src dir), Tailwind CSS, PostgreSQL, Prisma, bcryptjs, jose, zod, csv-parse, Vitest + vitest-mock-extended for testing.

## Global Constraints

- Platform scope: **Ikas only** for MVP — no live Ikas API integration in Sprint 1, only CSV import (PRD §13.1, §23 "0-1 Ay: Prototip", §25.3 item 2).
- `add_to_cart` / sepete ekleme is explicitly MVP+ / out of scope for Sprint 1 (PRD §9.1).
- Every service function and API route that touches store data must take/scope by `storeId` — no cross-tenant leaks (PRD §25.4 "Her API'de store_id kontrolu").
- Backend: Next.js API routes, not a separate NestJS service (PRD §18.2).
- Database: PostgreSQL via Prisma ORM (PRD §18.2, §16.1). Decided during execution: hosted on **Supabase**, accessed via two env vars — `DATABASE_URL` (pooled, port 6543, `pgbouncer=true`, used by the Prisma client at runtime) and `DIRECT_URL` (direct, port 5432, used only by `prisma migrate`). See Task 2.
- Auth: custom JWT, httpOnly session cookie (PRD §18.2 lists this as an accepted option).
- TypeScript strict mode; no `any` (user preference — type safety matters).
- Secrets (`DATABASE_URL`, `JWT_SECRET`) live in `.env.local`, never committed; `.env.example` documents required keys.
- UI copy in Turkish, code identifiers (variables/functions/types) in English, commit messages in English (user preference).
- Package manager: npm.
- Installed Next.js version is **16.2.11** (confirmed in Task 1) — newer than a typical model's training data, with breaking changes vs. Next.js 14. `cookies()` from `next/headers` is **async** (`const cookieStore = await cookies()`), and dynamic route `params` in Route Handlers are **`Promise`-wrapped** (`{ params }: { params: Promise<{ id: string }> }`, then `const { id } = await params;`). `NextRequest.cookies` (used in `middleware.ts`) is unaffected and stays synchronous. All code blocks in this plan already reflect this — do not "correct" them back to the Next 14 synchronous style. Before writing any other Next.js-specific code not covered by this plan, check `node_modules/next/dist/docs/` for the current API shape rather than relying on training data.
- Prisma is version 7.9.0. `PrismaClient` and all model types (`Store`, `User`, `Product`, `ProductVariant`) import from `@/generated/prisma/client` (there is no `index.ts` at `@/generated/prisma` — importing the bare directory fails), never `"@prisma/client"` (see Task 2 for why). `PrismaClient` requires a driver `adapter` in its constructor — see Task 3. `vitest-mock-extended`'s `mockDeep<PrismaClient>()` (used throughout Tasks 6–9's tests) is **confirmed working** against Prisma 7's generated client shape — verified in Task 6, no adjustment needed, safe to keep using in Tasks 7–9 exactly as shown.
- **`prisma.$transaction(async (tx) => ...)` (interactive transactions) can intermittently fail with `P2028: Unable to start a transaction in the given time`** against Supabase's pgbouncer pool (`DATABASE_URL`, transaction-pooling mode) — discovered in Task 6 (`registerStoreWithOwner`), roughly 1-in-2 failure rate under rapid repeated calls before the fix. Fix: pass explicit options as the transaction's second argument, `{ maxWait: 10000, timeout: 10000 }` (defaults are 2000ms/5000ms, too tight for this connection path) — confirmed reliable with a 5-attempt real-database load test after raising them. Any future interactive `$transaction` call (Tasks 7–9 don't currently have one, but a later feature might) should use the same options. Route handlers wrapping a `$transaction` call must also not swallow every error into one generic message (see Task 6's register route) — narrow `catch` blocks to the specific Prisma error code they're meant to handle (e.g. `Prisma.PrismaClientKnownRequestError` with `code === "P2002"` for a real uniqueness conflict), or a transient infra timeout gets misreported as a business-logic error.
- Supabase connection strings need **different** SSL handling depending on who's connecting (see Task 3): `DATABASE_URL` (pooled, port 6543, used by the app via `@prisma/adapter-pg`/node-postgres) must NOT have `sslmode=require` in the URL — node-postgres's connection-string parser treats it as full certificate-chain verification and fails (`self-signed certificate in certificate chain`) against Supabase's cert; TLS is instead enabled explicitly in code via `ssl: { rejectUnauthorized: false }` passed alongside `connectionString`. `DIRECT_URL` (direct, port 5432, used only by the Prisma CLI's Rust migration engine) DOES need `sslmode=require` in the URL, or `prisma migrate` fails with a generic P1001. Don't "fix" one to match the other — they're different SSL stacks with different requirements.
- Turbopack (this Next.js version's default bundler) panics on paths containing multi-byte Turkish characters — this project's path has them (`Masaüstü`, `Aİ ASİSTAN YENİ`). `npm run dev` / `npm run build` already force `--webpack` (set in Task 1) — keep using the npm scripts as-is; don't invoke `next dev`/`next build` directly without `--webpack`.
- `eslint.config.mjs`'s `globalIgnores` excludes `src/generated/**` (fixed during Task 8) — without it, `npm run lint` hangs for 3+ minutes trying to type-aware-lint the ~8.7k-line generated Prisma client. If `npm run lint` ever hangs again after adding new generated/vendored code, check `globalIgnores` first before assuming it's a real lint issue.

---

## File Structure

```
package.json
tsconfig.json
next.config.mjs
tailwind.config.ts
postcss.config.js
.env.example
.gitignore
vitest.config.ts

prisma/
  schema.prisma

src/
  app/
    layout.tsx
    page.tsx
    admin/
      layout.tsx                  # checks session, redirects to /admin/login if absent
      login/
        page.tsx                  # login + register form (client component)
      products/
        page.tsx                  # product list + CSV import + add-product form
    api/
      auth/
        register/route.ts         # POST - create store + owner user
        login/route.ts            # POST - verify credentials, set session cookie
        logout/route.ts           # POST - clear session cookie
        me/route.ts               # GET  - current session info
      stores/
        [storeId]/route.ts        # GET/PATCH - store settings
      products/
        route.ts                  # GET (list) / POST (create)
        [productId]/route.ts      # GET / PATCH / DELETE
        import/route.ts           # POST - CSV import
  lib/
    db/
      prisma.ts                   # PrismaClient singleton
    auth/
      password.ts                 # hashPassword / verifyPassword
      jwt.ts                      # signSessionToken / verifySessionToken
      session.ts                  # cookie name + getSessionFromCookieHeader
    validation/
      auth.ts                     # zod schemas: registerSchema, loginSchema
      store.ts                    # zod schema: updateStoreSchema
      product.ts                  # zod schemas: createProductSchema, updateProductSchema
      csv.ts                      # zod schema for one parsed CSV row
    services/
      auth-service.ts             # registerStoreWithOwner, loginWithCredentials
      store-service.ts            # getStoreById, updateStoreSettings
      product-service.ts          # createProduct, listProducts, getProductById, updateProduct, deleteProduct
      csv-import-service.ts       # parseProductCsv, importProductsFromCsv
  middleware.ts                   # protects /admin/* (except /admin/login), redirects unauthenticated users

tests/
  lib/
    auth/
      password.test.ts
      jwt.test.ts
    services/
      auth-service.test.ts
      store-service.test.ts
      product-service.test.ts
      csv-import-service.test.ts
```

Files that change together (a service and its route) are still split by responsibility: services hold logic and are unit-tested directly; routes stay thin (parse request → call service → format response) and are covered by the manual verification checklist in Task 12 rather than duplicated route-level tests.

---

### Task 1: Proje İskeleti (Next.js + TypeScript + Tailwind + Git)

**Files:**
- Create: whole Next.js scaffold (`package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.js`, `src/app/layout.tsx`, `src/app/page.tsx`, `.gitignore`)
- Create: `.env.example`

**Interfaces:**
- Produces: a runnable Next.js dev server (`npm run dev`) and a working `npm run build`; every later task assumes this scaffold exists.

- [ ] **Step 1: Scaffold the project**

Run from the project root (`C:\Users\muham\OneDrive\Masaüstü\Aİ ASİSTAN YENİ`):

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Answer prompts (if any slip through) with: Turbopack for dev → No (keep default webpack for stability).

- [ ] **Step 2: Verify the scaffold builds**

Run: `npm run build`
Expected: build completes with "Compiled successfully" and no TypeScript errors.

- [ ] **Step 3: Add `.env.example`**

Create `.env.example`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dijital_satis_calisani?schema=public"
JWT_SECRET="replace-with-a-long-random-string"
```

- [ ] **Step 4: Confirm `.gitignore` covers env files**

Open `.gitignore` (created by `create-next-app`) and confirm it contains `.env*.local` and `node_modules`. If `.env.local` is not covered, add this line:

```
.env.local
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with TypeScript and Tailwind"
```

---

### Task 2: Prisma Şema ve Migration — DONE (as of commit `8d89e79`)

**Status:** already implemented directly by the controller during execution (not dispatched to a subagent). The steps below are kept as the historical record and as the reference for what Task 3 (and any future Prisma work) builds on — do not redo this task.

**Files (as actually created):**
- `prisma/schema.prisma`, `prisma/migrations/20260724125610_init/`, `prisma.config.ts`
- `.env.example` updated with `DATABASE_URL` (no `sslmode` — see point 5, added in Task 3) + `DIRECT_URL` (requires `sslmode=require`)
- `package.json`: added `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` (deps), `@types/pg`, `dotenv` (devDeps), and a `postinstall: "prisma generate"` script

**What actually happened (deviates from the plan as originally written — kept here so later tasks aren't confused by stale assumptions):**

1. **Installed Prisma version is 7.9.0**, not 5/6 as the plan originally assumed. Prisma 7 has two breaking changes that matter for this whole project:
   - `datasource.url` **cannot** be set inline in `schema.prisma` anymore (hard validation error `P1012`). Connection config now lives in a separate `prisma.config.ts` file, and `PrismaClient` **requires** a driver `adapter` passed to its constructor — see Task 3.
   - The default generator is `provider = "prisma-client"` (not `"prisma-client-js"`), and it generates into a custom path (`src/generated/prisma` here) instead of `node_modules/@prisma/client`, with no `index.ts` at the directory root. **Every import of Prisma types/classes in this plan must come from `@/generated/prisma/client` (the tsconfig `@/*` → `src/*` alias), not from `"@prisma/client"` and not from the bare `@/generated/prisma` directory.** This affects Task 3, and every test file in Tasks 6–9 that imports `PrismaClient`, `Store`, `User`, `Product`, or `ProductVariant` types.
2. **Database is Supabase Postgres**, decided during execution (not local Postgres, not a schema-inline URL). Supabase's Connect → ORMs → Prisma panel gives two connection strings: a pooled one (port 6543, `pgbouncer=true`) for the app at runtime, and a "session pooler" one (port 5432) for migrations — PgBouncer's transaction-mode pooling doesn't support the prepared statements Prisma Migrate needs.
3. Since `prisma.config.ts` runs outside Next.js (no automatic `.env.local` loading), it loads env vars itself via `dotenv`, pointed explicitly at `.env.local` — and passes `{ quiet: true }`, because `dotenv` 17.x prints a random one-line promotional "tip" banner on every load otherwise (harmless — verified against `dotenv`'s own bundled source, not a compromised package — but noisy and worth suppressing).
4. `prisma.config.ts`'s `datasource.url` is set to `DIRECT_URL` (used by the CLI for `migrate`/`studio`/`db pull`), not `DATABASE_URL` — the pooled URL is only consumed by the app's own `PrismaClient` construction in Task 3, not by the CLI.
5. **`DIRECT_URL` needs `?sslmode=require` appended; `DATABASE_URL` must NOT have it** — this asymmetry was only discovered in Task 3 once the app-side driver adapter (`@prisma/adapter-pg`, wrapping node-postgres) was written; see Task 3's writeup for the full explanation. Without `sslmode=require`, `prisma migrate` fails with a generic `P1001: Can't reach database server` even though the host is reachable (confirmed with a raw `pg` client test — connectivity was never the real problem). With `sslmode=require` on `DATABASE_URL`, node-postgres instead fails with `self-signed certificate in certificate chain`, because its connection-string parser treats `sslmode=require` as full certificate-chain verification, unlike Prisma's own Rust migration engine.

**Final `prisma/schema.prisma`:**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum StoreStatus {
  ACTIVE
  INACTIVE
}

enum ProductStatus {
  ACTIVE
  DRAFT
  ARCHIVED
}

model Store {
  id        String      @id @default(cuid())
  name      String
  platform  String      @default("ikas")
  domain    String?
  language  String      @default("tr")
  currency  String      @default("TRY")
  timezone  String      @default("Europe/Istanbul")
  status    StoreStatus @default(ACTIVE)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  users    User[]
  products Product[]

  @@map("stores")
}

model User {
  id           String   @id @default(cuid())
  storeId      String
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId])
  @@map("users")
}

model Product {
  id          String        @id @default(cuid())
  storeId     String
  externalId  String?
  title       String
  description String?
  categoryId  String?
  brand       String?
  url         String?
  imageUrl    String?
  status      ProductStatus @default(ACTIVE)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  store    Store            @relation(fields: [storeId], references: [id], onDelete: Cascade)
  variants ProductVariant[]

  @@index([storeId])
  @@map("products")
}

model ProductVariant {
  id                String   @id @default(cuid())
  productId         String
  externalVariantId String?
  sku               String?
  title             String?
  price             Decimal  @db.Decimal(10, 2)
  compareAtPrice    Decimal? @db.Decimal(10, 2)
  currency          String   @default("TRY")
  stockQuantity     Int      @default(0)
  attributesJson    Json?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
  @@map("product_variants")
}
```

Migration `20260724125610_init` was applied against `DIRECT_URL` (`npx prisma migrate dev --name init`, after adding `sslmode=require` — see point 5 above) and the client was generated to `src/generated/prisma` (`npx prisma generate`). Schema validated clean (`npx prisma validate` → `The schema at prisma\schema.prisma is valid 🚀`). Committed as `8d89e79`.

---

### Task 3: Prisma Client Singleton — DONE

**Status:** first attempt was dispatched to an implementer subagent, which correctly hit and escalated (BLOCKED, did not guess) two real problems the plan hadn't anticipated. The controller investigated both, confirmed fixes against the real database, and finished the task directly. The steps below reflect the corrected, working version — do not redo this task.

**Files (as actually created):**
- `src/lib/db/prisma.ts`

**Two things the original plan text got wrong, discovered during implementation:**

1. **Import path:** `@/generated/prisma` has no `index.ts` — Prisma 7's `prisma-client` generator writes `client.ts`, `enums.ts`, `models.ts`, etc. directly in the output directory with no barrel file. The correct import is `@/generated/prisma/client`. (Already corrected everywhere else in this plan and in Global Constraints.)
2. **SSL:** passing `{ connectionString: process.env.DATABASE_URL }` alone to `PrismaPg` fails with `self-signed certificate in certificate chain`, even though the exact same connection worked fine for `pg` in Task 2's diagnostics. Root cause: node-postgres's own connection-string parser (`pg-connection-string`) treats a bare `sslmode=require` in the URL as full certificate-chain verification (a recent security hardening in that library — it prints a loud deprecation warning about this exact behavior). Supabase's certificate chain isn't in Node's default trust store, so verification fails. Fix: `DATABASE_URL` must NOT contain `sslmode=require` (removed in `.env.local`/`.env.example`), and TLS is instead enabled explicitly via an `ssl` option passed alongside `connectionString` to `PrismaPg`, with `rejectUnauthorized: false` (matches Supabase's own documented guidance for node-postgres — Supabase's pooler still encrypts the connection, this only skips CA validation, which is the standard tradeoff for connecting to a managed Postgres provider from node-postgres). Confirmed working with a real `$queryRaw` round-trip against the Supabase database.

**Interfaces:**
- Produces: `prisma: PrismaClient` — the single import every service and API route uses for DB access.

**Final `src/lib/db/prisma.ts`:**

```typescript
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  // Supabase's pooler cert isn't in Node's default trust store; the
  // connection is still encrypted, this only skips CA verification.
  // Do NOT add sslmode=require to DATABASE_URL instead — node-postgres's
  // connection-string parser treats that as full verify-full and fails.
  ssl: { rejectUnauthorized: false },
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Verified with a throwaway `scripts/check-db.ts` (same shape as originally planned: import `prisma`, run `$queryRaw\`SELECT 1 as ok\``, log and disconnect, deleted after confirming) — output: `DB connection OK: [ { ok: 1 } ]`. When running standalone scripts like this via `npx tsx`, note Next.js's automatic `.env.local` loading does **not** apply outside the Next.js process — use `dotenv`'s `config({ path: ".env.local" })` at the top of the script (see `prisma.config.ts` in Task 2 for the exact pattern), not a bare `tsx` invocation.

Committed as part of Task 3's commit — `git commit -m "feat: add Prisma client singleton with pg driver adapter"`.

---

### Task 4: Şifre Hashleme Servisi (TDD)

**Files:**
- Create: `src/lib/auth/password.ts`
- Test: `tests/lib/auth/password.test.ts`
- Modify: `package.json` (add `bcryptjs`, `vitest`, `vitest-mock-extended`, `vite-tsconfig-paths`)

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, hash: string): Promise<boolean>` — used by `auth-service.ts` (Task 6).

- [ ] **Step 1: Install test tooling and bcryptjs**

```bash
npm install bcryptjs
npm install -D vitest vitest-mock-extended vite-tsconfig-paths @types/bcryptjs
```

- [ ] **Step 2: Configure Vitest**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

Add to `package.json` `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the failing test**

Create `tests/lib/auth/password.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("produces a hash different from the plain password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
  });

  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/auth/password'`

- [ ] **Step 5: Implement**

Create `src/lib/auth/password.ts`:

```typescript
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/password.ts tests/lib/auth/password.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: add password hashing service with tests"
```

---

### Task 5: JWT Session Token Servisi (TDD)

**Files:**
- Create: `src/lib/auth/jwt.ts`
- Test: `tests/lib/auth/jwt.test.ts`
- Modify: `package.json` (add `jose`)

**Interfaces:**
- Consumes: `process.env.JWT_SECRET`
- Produces: `type SessionPayload = { userId: string; storeId: string; email: string }`, `signSessionToken(payload: SessionPayload): Promise<string>`, `verifySessionToken(token: string): Promise<SessionPayload | null>` — used by `auth-service.ts` and `middleware.ts`.

- [ ] **Step 1: Install jose**

```bash
npm install jose
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/auth/jwt.test.ts`:

```typescript
import { beforeAll, describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "@/lib/auth/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
});

describe("session JWT", () => {
  const payload = { userId: "user_1", storeId: "store_1", email: "owner@example.com" };

  it("round-trips a valid token", async () => {
    const token = await signSessionToken(payload);
    const decoded = await verifySessionToken(token);
    expect(decoded).toEqual(payload);
  });

  it("returns null for a tampered token", async () => {
    const token = await signSessionToken(payload);
    const tampered = token.slice(0, -2) + "xx";
    const decoded = await verifySessionToken(tampered);
    expect(decoded).toBeNull();
  });

  it("returns null for garbage input", async () => {
    const decoded = await verifySessionToken("not-a-real-token");
    expect(decoded).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/auth/jwt'`

- [ ] **Step 4: Implement**

Create `src/lib/auth/jwt.ts`:

```typescript
import { SignJWT, jwtVerify } from "jose";

export type SessionPayload = {
  userId: string;
  storeId: string;
  email: string;
};

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.userId === "string" &&
      typeof payload.storeId === "string" &&
      typeof payload.email === "string"
    ) {
      return { userId: payload.userId, storeId: payload.storeId, email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: 3 passed (plus the 3 from Task 4 — 6 total)

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/jwt.ts tests/lib/auth/jwt.test.ts package.json package-lock.json
git commit -m "feat: add JWT session token signing and verification"
```

---

### Task 6: Auth Servisi + API Rotaları + Middleware

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/validation/auth.ts`
- Create: `src/lib/services/auth-service.ts`
- Test: `tests/lib/services/auth-service.test.ts`
- Create: `src/app/api/auth/register/route.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/me/route.ts`
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 4), `signSessionToken`/`verifySessionToken`/`SessionPayload` (Task 5), `prisma` (Task 3).
- Produces: `SESSION_COOKIE_NAME` constant, `registerStoreWithOwner(input: RegisterInput): Promise<{ store: Store; user: User }>`, `loginWithCredentials(email: string, password: string): Promise<{ store: Store; user: User } | null>` — consumed by the API routes in this task and by `middleware.ts`.

- [ ] **Step 1: Write session cookie helper**

Create `src/lib/auth/session.ts`:

```typescript
export const SESSION_COOKIE_NAME = "ds_session";
```

- [ ] **Step 2: Write validation schemas**

Create `src/lib/validation/auth.ts`:

```typescript
import { z } from "zod";

export const registerSchema = z.object({
  storeName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
```

Install zod if not already present:

```bash
npm install zod
```

- [ ] **Step 3: Write the failing service test**

Create `tests/lib/services/auth-service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { registerStoreWithOwner, loginWithCredentials } from "@/lib/services/auth-service";
import { hashPassword } from "@/lib/auth/password";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("registerStoreWithOwner", () => {
  it("creates a store and an owner user inside a transaction", async () => {
    const fakeStore = { id: "store_1", name: "Test Mağaza" } as any;
    const fakeUser = { id: "user_1", storeId: "store_1", email: "owner@example.com" } as any;

    prismaMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        store: { create: vi.fn().mockResolvedValue(fakeStore) },
        user: { create: vi.fn().mockResolvedValue(fakeUser) },
      }),
    );

    const result = await registerStoreWithOwner({
      storeName: "Test Mağaza",
      email: "owner@example.com",
      password: "supersecret1",
    });

    expect(result.store).toEqual(fakeStore);
    expect(result.user).toEqual(fakeUser);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("loginWithCredentials", () => {
  it("returns store and user when the password matches", async () => {
    const passwordHash = await hashPassword("supersecret1");
    const fakeUser = {
      id: "user_1",
      storeId: "store_1",
      email: "owner@example.com",
      passwordHash,
    } as any;
    const fakeStore = { id: "store_1", name: "Test Mağaza" } as any;

    prismaMock.user.findUnique.mockResolvedValue(fakeUser);
    prismaMock.store.findUnique.mockResolvedValue(fakeStore);

    const result = await loginWithCredentials("owner@example.com", "supersecret1");

    expect(result?.user.id).toBe("user_1");
    expect(result?.store.id).toBe("store_1");
  });

  it("returns null when the user does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await loginWithCredentials("nobody@example.com", "whatever");

    expect(result).toBeNull();
  });

  it("returns null when the password is wrong", async () => {
    const passwordHash = await hashPassword("supersecret1");
    const fakeUser = {
      id: "user_1",
      storeId: "store_1",
      email: "owner@example.com",
      passwordHash,
    } as any;

    prismaMock.user.findUnique.mockResolvedValue(fakeUser);

    const result = await loginWithCredentials("owner@example.com", "wrong-password");

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/services/auth-service'`

- [ ] **Step 5: Implement the service**

Create `src/lib/services/auth-service.ts`:

```typescript
import type { Store, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { RegisterInput } from "@/lib/validation/auth";

export async function registerStoreWithOwner(
  input: RegisterInput,
): Promise<{ store: Store; user: User }> {
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(
    async (tx) => {
      const store = await tx.store.create({
        data: { name: input.storeName },
      });
      const user = await tx.user.create({
        data: { storeId: store.id, email: input.email, passwordHash },
      });
      return { store, user };
    },
    // Supabase's pgbouncer pool (transaction mode, port 6543) plus network
    // latency can exceed Prisma's 2s/5s defaults for acquiring a
    // transaction-pinned connection, intermittently throwing P2028
    // ("Unable to start a transaction in the given time") - confirmed via
    // a 5-attempt real-DB load test after raising these. Raised both well
    // above observed latency.
    { maxWait: 10000, timeout: 10000 },
  );
}

export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<{ store: Store; user: User } | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  const store = await prisma.store.findUnique({ where: { id: user.storeId } });
  if (!store) {
    return null;
  }

  return { store, user };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: 4 passed (auth-service) + 6 previous = 10 total

- [ ] **Step 7: Write the API routes**

Create `src/app/api/auth/register/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { registerSchema } from "@/lib/validation/auth";
import { registerStoreWithOwner } from "@/lib/services/auth-service";
import { signSessionToken } from "@/lib/auth/jwt";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { store, user } = await registerStoreWithOwner(parsed.data);
    const token = await signSessionToken({ userId: user.id, storeId: store.id, email: user.email });

    const response = NextResponse.json({ store: { id: store.id, name: store.name } }, { status: 201 });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Bu e-posta ile bir hesap zaten var." }, { status: 409 });
    }
    return NextResponse.json({ error: "Kayıt oluşturulamadı, lütfen tekrar deneyin." }, { status: 500 });
  }
}
```

The original catch-all (any error → 409 "email already exists") was replaced after discovering it masked a real, recurring problem: intermittent `P2028` transaction-timeout errors (see the `$transaction` options above) were being reported to the user as "this email is taken," which is both wrong and actively misleading during debugging. Narrowing to Prisma's `P2002` unique-constraint code fixes both the misdiagnosis and the user-facing message accuracy.

Create `src/app/api/auth/login/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { loginWithCredentials } from "@/lib/services/auth-service";
import { signSessionToken } from "@/lib/auth/jwt";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await loginWithCredentials(parsed.data.email, parsed.data.password);
  if (!result) {
    return NextResponse.json({ error: "E-posta veya şifre hatalı." }, { status: 401 });
  }

  const token = await signSessionToken({
    userId: result.user.id,
    storeId: result.store.id,
    email: result.user.email,
  });

  const response = NextResponse.json({ store: { id: result.store.id, name: result.store.name } });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
```

Create `src/app/api/auth/logout/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
```

Create `src/app/api/auth/me/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ session: null }, { status: 200 });
  }

  const session = await verifySessionToken(token);
  return NextResponse.json({ session });
}
```

- [ ] **Step 8: Write middleware to protect `/admin/*`**

Create `src/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
```

- [ ] **Step 9: Verify manually**

Run: `npm run dev`, then in a second terminal:

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"storeName":"Deneme Mağaza","email":"owner@example.com","password":"supersecret1"}'
```

Expected: `HTTP/1.1 201 Created`, JSON body with `store.id`, and a `Set-Cookie: ds_session=...` header.

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth src/lib/validation/auth.ts src/lib/services/auth-service.ts tests/lib/services/auth-service.test.ts src/app/api/auth src/middleware.ts package.json package-lock.json
git commit -m "feat: add auth service, session cookie, and protected /admin middleware"
```

---

### Task 7: Store Servisi + API Rotası

**Files:**
- Create: `src/lib/validation/store.ts`
- Create: `src/lib/services/store-service.ts`
- Test: `tests/lib/services/store-service.test.ts`
- Create: `src/app/api/stores/[storeId]/route.ts`

**Interfaces:**
- Consumes: `prisma` (Task 3), `verifySessionToken`/`SESSION_COOKIE_NAME` (Tasks 5–6) for auth in the route.
- Produces: `getStoreById(storeId: string): Promise<Store | null>`, `updateStoreSettings(storeId: string, input: UpdateStoreInput): Promise<Store>` — used by the admin dashboard in later sprints too.

- [ ] **Step 1: Write validation schema**

Create `src/lib/validation/store.ts`:

```typescript
import { z } from "zod";

export const updateStoreSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  domain: z.string().url().optional(),
  language: z.string().min(2).max(10).optional(),
  currency: z.string().min(3).max(3).optional(),
  timezone: z.string().min(2).max(64).optional(),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/services/store-service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStoreById, updateStoreSettings } from "@/lib/services/store-service";

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe("getStoreById", () => {
  it("returns the store when found", async () => {
    const fakeStore = { id: "store_1", name: "Test Mağaza" } as any;
    prismaMock.store.findUnique.mockResolvedValue(fakeStore);

    const result = await getStoreById("store_1");

    expect(result).toEqual(fakeStore);
    expect(prismaMock.store.findUnique).toHaveBeenCalledWith({ where: { id: "store_1" } });
  });

  it("returns null when not found", async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);
    const result = await getStoreById("missing");
    expect(result).toBeNull();
  });
});

describe("updateStoreSettings", () => {
  it("updates only the provided fields", async () => {
    const fakeStore = { id: "store_1", name: "Yeni İsim" } as any;
    prismaMock.store.update.mockResolvedValue(fakeStore);

    const result = await updateStoreSettings("store_1", { name: "Yeni İsim" });

    expect(result).toEqual(fakeStore);
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: "store_1" },
      data: { name: "Yeni İsim" },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/services/store-service'`

- [ ] **Step 4: Implement**

Create `src/lib/services/store-service.ts`:

```typescript
import type { Store } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { UpdateStoreInput } from "@/lib/validation/store";

export async function getStoreById(storeId: string): Promise<Store | null> {
  return prisma.store.findUnique({ where: { id: storeId } });
}

export async function updateStoreSettings(
  storeId: string,
  input: UpdateStoreInput,
): Promise<Store> {
  return prisma.store.update({ where: { id: storeId }, data: input });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: 3 passed (store-service) + 10 previous = 13 total

- [ ] **Step 6: Write the auth-aware API route**

Create `src/app/api/stores/[storeId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import { getStoreById, updateStoreSettings } from "@/lib/services/store-service";
import { updateStoreSchema } from "@/lib/validation/store";

async function requireSessionForStore(storeId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session || session.storeId !== storeId) {
    return null;
  }
  return session;
}

type RouteParams = { params: Promise<{ storeId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { storeId } = await params;
  const session = await requireSessionForStore(storeId);
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const store = await getStoreById(storeId);
  if (!store) {
    return NextResponse.json({ error: "Mağaza bulunamadı." }, { status: 404 });
  }
  return NextResponse.json({ store });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { storeId } = await params;
  const session = await requireSessionForStore(storeId);
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = updateStoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const store = await updateStoreSettings(storeId, parsed.data);
  return NextResponse.json({ store });
}
```

This `requireSessionForStore` tenant check (session's `storeId` must match the URL's `storeId`) is the pattern every later tenant-scoped route in this plan reuses.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/store.ts src/lib/services/store-service.ts tests/lib/services/store-service.test.ts src/app/api/stores
git commit -m "feat: add store settings service and tenant-scoped API route"
```

---

### Task 8: Product Servisi (CRUD + Variant) + API Rotaları

**Files:**
- Create: `src/lib/validation/product.ts`
- Create: `src/lib/services/product-service.ts`
- Test: `tests/lib/services/product-service.test.ts`
- Create: `src/app/api/products/route.ts`
- Create: `src/app/api/products/[productId]/route.ts`

**Interfaces:**
- Consumes: `prisma` (Task 3), tenant session check pattern from Task 7.
- Produces: `type ProductWithVariants = Product & { variants: ProductVariant[] }`, `createProduct(storeId: string, input: CreateProductInput): Promise<ProductWithVariants>`, `listProducts(storeId: string): Promise<ProductWithVariants[]>`, `getProductById(storeId: string, productId: string): Promise<ProductWithVariants | null>`, `updateProduct(storeId: string, productId: string, input: UpdateProductInput): Promise<ProductWithVariants>`, `deleteProduct(storeId: string, productId: string): Promise<void>` — used by the CSV import service (Task 9) and the admin products page (Task 11).

- [ ] **Step 1: Write validation schemas**

Create `src/lib/validation/product.ts`:

```typescript
import { z } from "zod";

export const productVariantInputSchema = z.object({
  sku: z.string().max(64).optional(),
  title: z.string().max(120).optional(),
  price: z.number().positive(),
  compareAtPrice: z.number().positive().optional(),
  stockQuantity: z.number().int().min(0).default(0),
});

export const createProductSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  categoryId: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  variants: z.array(productVariantInputSchema).min(1),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/services/product-service.test.ts`:

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

vi.mock("@/lib/db/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
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
});

describe("deleteProduct", () => {
  it("throws when the product does not belong to the store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expect(deleteProduct("store_1", "missing")).rejects.toThrow("Ürün bulunamadı.");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/services/product-service'`

- [ ] **Step 4: Implement**

Create `src/lib/services/product-service.ts`:

```typescript
import type { Product, ProductVariant } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { CreateProductInput, UpdateProductInput } from "@/lib/validation/product";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

export async function createProduct(
  storeId: string,
  input: CreateProductInput,
): Promise<ProductWithVariants> {
  return prisma.product.create({
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

  return prisma.product.update({
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
}

export async function deleteProduct(storeId: string, productId: string): Promise<void> {
  const existing = await prisma.product.findFirst({ where: { id: productId, storeId } });
  if (!existing) {
    throw new Error("Ürün bulunamadı.");
  }
  await prisma.product.delete({ where: { id: productId } });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: 6 passed (product-service) + 13 previous = 19 total

- [ ] **Step 6: Write the API routes**

Create `src/app/api/products/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import { createProduct, listProducts } from "@/lib/services/product-service";
import { createProductSchema } from "@/lib/validation/product";

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
  const products = await listProducts(session.storeId);
  return NextResponse.json({ products });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const product = await createProduct(session.storeId, parsed.data);
  return NextResponse.json({ product }, { status: 201 });
}
```

Create `src/app/api/products/[productId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import { getProductById, updateProduct, deleteProduct } from "@/lib/services/product-service";
import { updateProductSchema } from "@/lib/validation/product";

async function requireSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : null;
}

type RouteParams = { params: Promise<{ productId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { productId } = await params;
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }
  const product = await getProductById(session.storeId, productId);
  if (!product) {
    return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  }
  return NextResponse.json({ product });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { productId } = await params;
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const product = await updateProduct(session.storeId, productId, parsed.data);
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { productId } = await params;
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  try {
    await deleteProduct(session.storeId, productId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/product.ts src/lib/services/product-service.ts tests/lib/services/product-service.test.ts src/app/api/products
git commit -m "feat: add tenant-scoped product CRUD service and API routes"
```

---

### Task 9: CSV Import Servisi + API Rotası

**Files:**
- Create: `src/lib/validation/csv.ts`
- Create: `src/lib/services/csv-import-service.ts`
- Test: `tests/lib/services/csv-import-service.test.ts`
- Create: `src/app/api/products/import/route.ts`
- Modify: `package.json` (add `csv-parse`)

**Interfaces:**
- Consumes: `createProduct` (Task 8), `prisma` (Task 3).
- Produces: `parseProductCsv(csvText: string): { rows: ParsedProductRow[]; rowErrors: string[] }`, `importProductsFromCsv(storeId: string, csvText: string): Promise<ImportResult>` where `ImportResult = { imported: number; failed: number; errors: string[] }`.

CSV format (documented here since it is not written down elsewhere): header row `title,description,category,brand,price,stock,sku,imageUrl` — `title` and `price` are required, everything else optional.

- [ ] **Step 1: Install csv-parse**

```bash
npm install csv-parse
```

- [ ] **Step 2: Write validation schema for one row**

Create `src/lib/validation/csv.ts`:

```typescript
import { z } from "zod";

export const csvProductRowSchema = z.object({
  title: z.string().min(1, "title zorunludur"),
  description: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  price: z.coerce.number().positive("price pozitif bir sayı olmalı"),
  stock: z.coerce.number().int().min(0).optional().default(0),
  sku: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
});

export type CsvProductRow = z.infer<typeof csvProductRowSchema>;
```

- [ ] **Step 3: Write the failing test**

Create `tests/lib/services/csv-import-service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProductCsv, importProductsFromCsv } from "@/lib/services/csv-import-service";
import * as productService from "@/lib/services/product-service";

describe("parseProductCsv", () => {
  it("parses valid rows", () => {
    const csv = "title,price,stock\nKoltuk Takımı,14999.90,3\nSehpa,1299.00,10\n";
    const { rows, rowErrors } = parseProductCsv(csv);

    expect(rowErrors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Koltuk Takımı", price: 14999.9, stock: 3 });
  });

  it("collects an error for a row missing the required title", () => {
    const csv = "title,price\n,199.00\n";
    const { rows, rowErrors } = parseProductCsv(csv);

    expect(rows).toHaveLength(0);
    expect(rowErrors).toHaveLength(1);
    expect(rowErrors[0]).toContain("title zorunludur");
  });

  it("collects an error for a non-numeric price", () => {
    const csv = "title,price\nKoltuk,abc\n";
    const { rows, rowErrors } = parseProductCsv(csv);

    expect(rows).toHaveLength(0);
    expect(rowErrors).toHaveLength(1);
  });
});

describe("importProductsFromCsv", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates one product per valid row and reports parse errors as failures", async () => {
    const createProductSpy = vi
      .spyOn(productService, "createProduct")
      .mockResolvedValue({ id: "product_1" } as any);

    const csv = "title,price\nKoltuk,1999.00\n,abc\n";
    const result = await importProductsFromCsv("store_1", csv);

    expect(createProductSpy).toHaveBeenCalledTimes(1);
    expect(createProductSpy).toHaveBeenCalledWith(
      "store_1",
      expect.objectContaining({
        title: "Koltuk",
        variants: [expect.objectContaining({ price: 1999 })],
      }),
    );
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/services/csv-import-service'`

- [ ] **Step 5: Implement**

Create `src/lib/services/csv-import-service.ts`:

```typescript
import { parse } from "csv-parse/sync";
import { csvProductRowSchema, type CsvProductRow } from "@/lib/validation/csv";
import { createProduct } from "@/lib/services/product-service";

export type ImportResult = {
  imported: number;
  failed: number;
  errors: string[];
};

export function parseProductCsv(csvText: string): {
  rows: CsvProductRow[];
  rowErrors: string[];
} {
  const records: Record<string, string>[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const rows: CsvProductRow[] = [];
  const rowErrors: string[] = [];

  records.forEach((record, index) => {
    const result = csvProductRowSchema.safeParse(record);
    if (result.success) {
      rows.push(result.data);
    } else {
      const rowNumber = index + 2; // +1 for header row, +1 for 1-based indexing
      const message = result.error.errors.map((e) => e.message).join("; ");
      rowErrors.push(`Satır ${rowNumber}: ${message}`);
    }
  });

  return { rows, rowErrors };
}

export async function importProductsFromCsv(
  storeId: string,
  csvText: string,
): Promise<ImportResult> {
  const { rows, rowErrors } = parseProductCsv(csvText);
  const errors = [...rowErrors];
  let imported = 0;

  for (const row of rows) {
    try {
      await createProduct(storeId, {
        title: row.title,
        description: row.description,
        categoryId: row.category,
        brand: row.brand,
        imageUrl: row.imageUrl || undefined,
        variants: [{ sku: row.sku, price: row.price, stockQuantity: row.stock ?? 0 }],
      });
      imported += 1;
    } catch (error) {
      errors.push(`"${row.title}" içe aktarılamadı: ${(error as Error).message}`);
    }
  }

  return { imported, failed: errors.length, errors };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: 4 passed (csv-import-service) + 19 previous = 23 total

- [ ] **Step 7: Write the API route**

Create `src/app/api/products/import/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import { importProductsFromCsv } from "@/lib/services/csv-import-service";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV dosyası bulunamadı." }, { status: 400 });
  }

  const csvText = await file.text();
  const result = await importProductsFromCsv(session.storeId, csvText);
  return NextResponse.json(result);
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/csv.ts src/lib/services/csv-import-service.ts tests/lib/services/csv-import-service.test.ts src/app/api/products/import package.json package-lock.json
git commit -m "feat: add CSV product import service and API route"
```

---

### Task 10: Admin UI - Giriş/Kayıt Sayfası

**Files:**
- Create: `src/app/admin/login/page.tsx`
- Create: `src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/register`, `POST /api/auth/login` (Task 6).
- Produces: the `/admin/login` route that `middleware.ts` (Task 6) redirects unauthenticated users to.

- [ ] **Step 1: Write the admin layout shell**

Create `src/app/admin/layout.tsx`:

```tsx
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Write the login/register page**

Create `src/app/admin/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      mode === "login" ? { email, password } : { storeName, email, password };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setIsSubmitting(false);

    if (!response.ok) {
      const data = await response.json();
      setError(typeof data.error === "string" ? data.error : "Bir hata oluştu.");
      return;
    }

    router.push("/admin/products");
    router.refresh();
  }

  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-xl font-semibold">
        {mode === "login" ? "Giriş Yap" : "Mağaza Oluştur"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "register" && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Mağaza Adı</label>
            <input
              type="text"
              required
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">E-posta</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Şifre</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
        className="mt-4 text-sm text-gray-600 underline"
      >
        {mode === "login" ? "Hesabın yok mu? Mağaza oluştur" : "Zaten hesabın var mı? Giriş yap"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, visit `http://localhost:3000/admin/products` in a browser.
Expected: redirected to `/admin/login` (via middleware). Fill the register form → on success, redirected to `/admin/products` (a 404/placeholder until Task 11, which is expected at this point).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/login src/app/admin/layout.tsx
git commit -m "feat: add admin login/register page"
```

---

### Task 11: Admin UI - Ürünler Sayfası (Liste + Manuel Ekleme + CSV Import)

**Files:**
- Create: `src/app/admin/products/page.tsx`

**Interfaces:**
- Consumes: `GET /api/products`, `POST /api/products`, `POST /api/products/import` (Tasks 8–9).

- [ ] **Step 1: Write the products page**

Create `src/app/admin/products/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Variant = { id: string; price: string; stockQuantity: number };
type Product = { id: string; title: string; brand: string | null; variants: Variant[] };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProducts() {
    const response = await fetch("/api/products");
    const data = await response.json();
    setProducts(data.products ?? []);
  }

  useEffect(() => {
    loadProducts();
  }, []);

  async function handleAddProduct(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        variants: [{ price: Number(price), stockQuantity: Number(stock) }],
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(JSON.stringify(data.error));
      return;
    }

    setTitle("");
    setPrice("");
    setStock("0");
    await loadProducts();
  }

  async function handleCsvImport(event: React.FormEvent) {
    event.preventDefault();
    setImportMessage(null);
    if (!csvFile) {
      return;
    }

    const formData = new FormData();
    formData.append("file", csvFile);

    const response = await fetch("/api/products/import", { method: "POST", body: formData });
    const data = await response.json();
    setImportMessage(`İçe aktarılan: ${data.imported}, başarısız: ${data.failed}`);
    await loadProducts();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Ürünler</h1>

      <form onSubmit={handleAddProduct} className="flex flex-wrap items-end gap-3 rounded border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-sm text-gray-700">Ürün Adı</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700">Fiyat</label>
          <input
            required
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700">Stok</label>
          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="w-20 rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <button type="submit" className="rounded bg-gray-900 px-3 py-2 text-white">
          Ürün Ekle
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <form onSubmit={handleCsvImport} className="flex items-center gap-3 rounded border border-gray-200 bg-white p-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" className="rounded bg-gray-700 px-3 py-2 text-white">
          CSV İçe Aktar
        </button>
        {importMessage && <p className="text-sm text-gray-700">{importMessage}</p>}
      </form>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="py-2">Ürün</th>
            <th className="py-2">Marka</th>
            <th className="py-2">Fiyat</th>
            <th className="py-2">Stok</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-gray-100">
              <td className="py-2">{product.title}</td>
              <td className="py-2">{product.brand ?? "-"}</td>
              <td className="py-2">{product.variants[0]?.price ?? "-"}</td>
              <td className="py-2">{product.variants[0]?.stockQuantity ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

With `npm run dev` running and logged in from Task 10:
1. Add a product manually via the form → it appears in the table.
2. Create a CSV file `test-products.csv`:

```csv
title,price,stock
Koltuk Takımı,14999.90,3
Sehpa,1299.00,10
```

Upload it via the CSV import form → message shows `İçe aktarılan: 2, başarısız: 0`, both rows appear in the table.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/products
git commit -m "feat: add admin products page with manual add and CSV import"
```

---

### Task 12: Uçtan Uca Doğrulama

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: 23 passed, 0 failed.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors.

- [ ] **Step 3: Manual end-to-end walkthrough**

With `npm run dev` running against a real local Postgres:
1. Visit `/admin/products` while logged out → redirected to `/admin/login`.
2. Register a new store → redirected to `/admin/products`, empty product list.
3. Add one product manually → appears in the list.
4. Import the sample CSV from Task 11 Step 2 → 2 more products appear, count matches `İçe aktarılan: 2`.
5. Open `/api/auth/me` in the browser → returns the current session JSON (not null).
6. Call `POST /api/auth/logout`, then reload `/admin/products` → redirected to `/admin/login` again.
7. Confirm via `npx prisma studio` (or `psql`) that products created in step 3–4 have the correct `storeId` and that a second registered store (repeat step 2 with a different email) sees an empty product list in step to confirm tenant isolation.

- [ ] **Step 4: Record what's out of scope for next sprint**

No commit needed — this is a checklist confirmation only. Sprint 2 (per PRD §25.5) starts with Knowledge ingestion, Embedding, Vector search, and a basic RAG endpoint; none of that is touched in Sprint 1.

---

## Self-Review Notes

- **Spec coverage:** §25.5 Sprint 1 items — proje kurulumu (Task 1), database schema (Task 2–3), auth (Tasks 4–6), store/product CRUD (Tasks 7–8), CSV import (Task 9) — all covered. Admin UI (Tasks 10–11) was added because CRUD needs a way to be exercised; it maps to PRD §24.1 "Admin panel iskeleti", "Login ve mağaza seçimi" (simplified to single-store-per-user for Sprint 1).
- **Explicitly deferred (not gaps — MVP+/V2 per the revised PRD):** Ikas live API sync (§13.1, Sprint "0-1 Ay: Prototip" uses CSV only), `add_to_cart` (§9.1 MVP+), RAG/embeddings/agent (Sprint 2), analytics dashboard (§9.1 MVP+), handoff operations (§12.6, Sprint 3+ per roadmap).
- **Type consistency check:** `ProductWithVariants` (Task 8) is the single return type used by `createProduct`, `listProducts`, `getProductById`, `updateProduct` — `csv-import-service.ts` (Task 9) calls `createProduct` with the same `CreateProductInput` shape defined in Task 8, not a redefined one. `SessionPayload` (Task 5) is the one type used by `middleware.ts`, all API routes, and `auth-service.ts`.
