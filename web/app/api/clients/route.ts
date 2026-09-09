import { NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

/** GET /api/clients → Devuelve la lista de clientes/marcas registrados en la base de datos */
export async function GET() {
  try {
    const res = await fetch(`${FASTAPI_URL}/clients`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
