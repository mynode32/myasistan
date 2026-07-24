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
