import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const res = await fetch(`${FASTAPI_URL}/clips/download/${filename}`);
    if (!res.ok) {
      return new NextResponse("Video no encontrado", { status: res.status });
    }

    const headers = new Headers();
    headers.set("Content-Type", "video/mp4");
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    return new NextResponse(res.body, {
      status: 200,
      headers,
    });
  } catch {
    return new NextResponse("Error descargando el video", { status: 500 });
  }
}
