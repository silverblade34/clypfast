import { NextRequest, NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    const time = req.nextUrl.searchParams.get("time") ?? "0";

    if (!url) {
      return new NextResponse("Missing url parameter", { status: 400 });
    }

    const fastApiUrl = `${FASTAPI_URL}/thumbnail/frame?url=${encodeURIComponent(url)}&time=${encodeURIComponent(time)}`;
    const res = await fetch(fastApiUrl, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=43200",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
