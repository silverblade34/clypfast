import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/**
 * GET /api/clips/[id]/transcript
 * Proxy para obtener la transcripción del clip específico.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const res = await fetch(`${FASTAPI_URL}/clips/${id}/transcript`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { text: "", segments: [], available: false, detail: "Error conectando con FastAPI" },
      { status: 503 }
    );
  }
}
