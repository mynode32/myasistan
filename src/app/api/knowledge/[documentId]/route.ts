import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import {
  deleteKnowledgeDocument,
  getKnowledgeDocumentById,
  updateKnowledgeDocument,
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

  try {
    const document = await getKnowledgeDocumentById(session.storeId, documentId);
    if (!document) {
      return NextResponse.json({ error: "Bilgi dokümanı bulunamadı." }, { status: 404 });
    }
    return NextResponse.json({ document });
  } catch {
    return NextResponse.json(
      { error: "Bilgi dokümanı getirilemedi, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { documentId } = await params;
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

  const parsed = updateKnowledgeDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const existing = await getKnowledgeDocumentById(session.storeId, documentId);
    if (!existing) {
      return NextResponse.json({ error: "Bilgi dokümanı bulunamadı." }, { status: 404 });
    }
  } catch {
    return NextResponse.json(
      { error: "Bilgi dokümanı kontrol edilemedi, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }

  try {
    const document = await updateKnowledgeDocument(session.storeId, documentId, parsed.data);
    return NextResponse.json({ document });
  } catch {
    return NextResponse.json(
      { error: "Bilgi dokümanı güncellenemedi, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { documentId } = await params;
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  try {
    const existing = await getKnowledgeDocumentById(session.storeId, documentId);
    if (!existing) {
      return NextResponse.json({ error: "Bilgi dokümanı bulunamadı." }, { status: 404 });
    }
  } catch {
    return NextResponse.json(
      { error: "Bilgi dokümanı kontrol edilemedi, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }

  try {
    await deleteKnowledgeDocument(session.storeId, documentId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Bilgi dokümanı silinemedi, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
