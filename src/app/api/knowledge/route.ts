import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import {
  createKnowledgeDocument,
  listKnowledgeDocuments,
} from "@/lib/services/knowledge-service";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON." }, { status: 400 });
  }

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
