import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");
    if (!url) return new NextResponse("Missing url", { status: 400 });
    if (!/^https?:\/\//i.test(url)) return new NextResponse("Invalid url", { status: 400 });

    const upstream = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!upstream.ok) return new NextResponse(`Upstream error: ${upstream.status}`, { status: 502 });

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("Proxy failed", { status: 500 });
  }
}
