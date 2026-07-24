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

  let result;
  try {
    result = await loginWithCredentials(parsed.data.email, parsed.data.password);
  } catch {
    return NextResponse.json(
      { error: "Giriş yapılamadı, lütfen tekrar deneyin." },
      { status: 500 },
    );
  }

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
