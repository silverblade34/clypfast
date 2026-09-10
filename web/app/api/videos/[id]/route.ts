import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/** GET /api/videos/[id] → Devuelve el video con sus metadatos */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await fetch(`${FASTAPI_URL}/videos/${id}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: "Error conectando con el servidor" }, { status: 503 });
  }
}

/** DELETE /api/videos/[id] → Elimina el video y sus archivos asociados */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await fetch(`${FASTAPI_URL}/videos/${id}`, {
      method: "DELETE",
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: "Error conectando con el servidor" }, { status: 503 });
  }
}

