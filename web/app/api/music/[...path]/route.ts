import { NextRequest } from "next/server";

const backend = process.env.FASTAPI_URL ?? "http://localhost:8000";
type Context = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    const headers = new Headers();
    if (req.headers.has("range")) headers.set("range", req.headers.get("range")!);
    if (req.headers.has("content-type")) headers.set("content-type", req.headers.get("content-type")!);
    const response = await fetch(`${backend}/music/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: ["POST", "PATCH"].includes(req.method) ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      signal: req.signal,
    });
    const outputHeaders = new Headers();
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
      if (response.headers.has(key)) outputHeaders.set(key, response.headers.get(key)!);
    }
    return new Response(response.body, { status: response.status, headers: outputHeaders });
  } catch {
    return Response.json({ detail: "No se pudo conectar al servidor. Comprueba que FastAPI esté ejecutándose." }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
