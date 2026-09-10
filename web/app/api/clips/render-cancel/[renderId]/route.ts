import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ renderId: string }> }
) {
  try {
    const { renderId } = await params;
    const res = await fetch(`${FASTAPI_URL}/clips/render-cancel/${renderId}`, {
      method: "POST",
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { detail: "No se pudo cancelar el renderizado" },
      { status: 503 }
    );
  }
}
