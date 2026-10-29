import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/**
 * POST /api/clips/[id]/generate-hooks
 * Genera opciones de títulos gancho de alto impacto y criterio humano para un clip.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let body = {};
    try {
      body = await req.json();
    } catch {}

    const res = await fetch(`${FASTAPI_URL}/clips/${id}/generate-hooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { detail: "Error conectando con el servidor para generar títulos gancho" },
      { status: 503 }
    );
  }
}
