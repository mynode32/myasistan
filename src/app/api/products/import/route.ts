import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";
import { importProductsFromCsv } from "@/lib/services/csv-import-service";

const MAX_CSV_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

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

  if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "CSV dosyası çok büyük. Maksimum dosya boyutu 2MB." },
      { status: 400 },
    );
  }

  const csvText = await file.text();
  const result = await importProductsFromCsv(session.storeId, csvText);
  return NextResponse.json(result);
}
