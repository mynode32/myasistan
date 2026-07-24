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
