import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/**
 * GET /api/videos/[id]/transcript?start_seconds=...&end_seconds=...
 * Proxy para obtener la transcripción completa o recortada por segundos del video.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const startSec = searchParams.get("start_seconds");
  const endSec = searchParams.get("end_seconds");

  let url = `${FASTAPI_URL}/videos/${id}/transcript`;
  const queryParts: string[] = [];
  if (startSec !== null) queryParts.push(`start_seconds=${startSec}`);
  if (endSec !== null) queryParts.push(`end_seconds=${endSec}`);
  if (queryParts.length > 0) {
    url += `?${queryParts.join("&")}`;
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { text: "", segments: [], available: false, detail: "Error conectando con FastAPI" },
      { status: 503 }
    );
  }
}
