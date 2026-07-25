import { spawn, type ChildProcess } from "node:child_process";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

const port = Number(process.env.E2E_PORT ?? 3210);
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const startsServer = !process.env.E2E_BASE_URL;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let server: ChildProcess | undefined;
let storeId: string | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next.js sunucusu 60 saniye içinde başlamadı: ${baseUrl}`);
}

async function cleanup() {
  if (!storeId || !process.env.DIRECT_URL) return;
  const connectionUrl = new URL(process.env.DIRECT_URL);
  connectionUrl.searchParams.delete("sslmode");
  const client = new Client({
    connectionString: connectionUrl.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('DELETE FROM "stores" WHERE "id" = $1', [storeId]);
  } finally {
    await client.end();
  }
}

async function main() {
  assert(process.env.OPENAI_API_KEY, "OPENAI_API_KEY .env.local içinde tanımlı olmalı.");
  assert(process.env.DIRECT_URL, "DIRECT_URL .env.local içinde tanımlı olmalı.");

  if (startsServer) {
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", String(port)],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );
  }
  await waitForServer();

  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storeName: `E2E RAG ${runId}`,
      email: `e2e-rag-${runId}@example.com`,
      password: "RealTest123!",
    }),
  });
  const registerBody = (await registerResponse.json()) as { store?: { id?: string }; error?: unknown };
  assert(registerResponse.status === 201, `Kayıt başarısız: ${JSON.stringify(registerBody)}`);
  assert(registerBody.store?.id, "Kayıt yanıtında store.id yok.");
  storeId = registerBody.store.id;

  const cookie = registerResponse.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert(cookie, "Kayıt yanıtında oturum cookie'si yok.");

  const knowledgeResponse = await fetch(`${baseUrl}/api/knowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      sourceType: "FAQ",
      title: "E2E kargo süresi",
      content: "E2E test siparişleri 2-3 iş günü içinde teslim edilir.",
      language: "tr",
    }),
  });
  const knowledgeBody = (await knowledgeResponse.json()) as { document?: { id?: string }; error?: unknown };
  assert(knowledgeResponse.status === 201, `Bilgi ekleme başarısız: ${JSON.stringify(knowledgeBody)}`);
  assert(knowledgeBody.document?.id, "Bilgi yanıtında document.id yok.");

  const ragResponse = await fetch(`${baseUrl}/api/rag/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ question: "E2E test siparişi ne kadar sürede teslim edilir?" }),
  });
  const ragBody = (await ragResponse.json()) as {
    answer?: string;
    sources?: { sourceType?: string; sourceId?: string; content?: string }[];
    error?: unknown;
  };
  assert(ragResponse.ok, `RAG sorgusu başarısız: ${JSON.stringify(ragBody)}`);
  assert(ragBody.answer, "RAG yanıtı boş.");
  assert(ragBody.sources, "RAG kaynak listesi yok.");
  assert(
    ragBody.sources.some(
      (source) =>
        source.sourceType === "FAQ" &&
        source.sourceId === knowledgeBody.document?.id &&
        source.content?.includes("2-3 iş günü"),
    ),
    `Beklenen FAQ kaynağı dönmedi: ${JSON.stringify(ragBody.sources)}`,
  );

  console.log(JSON.stringify({ ok: true, answer: ragBody.answer, sources: ragBody.sources.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } finally {
      if (server) server.kill();
    }
  });
