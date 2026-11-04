import { NextRequest } from "next/server";
import { findBySlug } from "@/lib/urlStore";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = findBySlug(slug);
  if (!entry) return new Response("Not found", { status: 404 });
  const upstream = await fetch(entry.originalUrl, { headers: { "accept-encoding": "identity" } });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "text/plain" } });
}