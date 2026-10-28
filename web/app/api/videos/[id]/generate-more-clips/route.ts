import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/** POST /api/videos/[id]/generate-more-clips → Generar más clips virales sin solapamiento */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    let body = {};
    try {
      body = await req.json();
    } catch {}

    const res = await fetch(`${FASTAPI_URL}/videos/${id}/generate-more-clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { detail: err?.message || "Error conectando con el servidor backend" },
      { status: 503 }
    );
  }
}
