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
