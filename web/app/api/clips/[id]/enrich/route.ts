import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/**
 * POST /api/clips/[id]/enrich
 * Proxy para ejecutar el análisis de Stage 2 (Social Content Analyzer) en un clip existente.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const res = await fetch(`${FASTAPI_URL}/clips/${id}/enrich`, {
      method: "POST",
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { detail: "Error conectando con FastAPI para Stage 2" },
      { status: 503 }
    );
  }
}
