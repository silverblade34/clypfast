import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/** GET /api/videos/lookup?url=... → Busca si ya existe ese video en el historial */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ detail: "Falta el parámetro url" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${FASTAPI_URL}/videos/lookup?url=${encodeURIComponent(url)}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { detail: "Error conectando con el servidor" },
      { status: 503 }
    );
  }
}
