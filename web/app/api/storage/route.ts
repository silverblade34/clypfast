import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/** GET /api/storage → Obtiene estadísticas de uso de disco en outputs/ */
export async function GET() {
  try {
    const res = await fetch(`${FASTAPI_URL}/storage`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { detail: "Error conectando con el servicio de almacenamiento" },
      { status: 503 }
    );
  }
}

/** POST /api/storage → Limpia archivos y carpetas huérfanas en outputs/ */
export async function POST() {
  try {
    const res = await fetch(`${FASTAPI_URL}/storage/clean-orphans`, {
      method: "POST",
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { detail: "Error limpiando archivos huérfanos" },
      { status: 503 }
    );
  }
}
