/**
 * app/api/gemini/[...path]/route.ts
 *
 * Path-pass-through tunnel to the Google Gemini API.
 *
 *   POST https://your-domain.com/api/gemini/v1beta/models/gemini-2.0-flash:generateContent
 *     -> https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
 *
 * No key handling, no body parsing. The caller's own
 * "x-goog-api-key" header rides through untouched, so the free
 * AI Studio key stays on the client side of the tunnel.
 *
 * Free-tier heads-up (see https://ai.google.dev/gemini-api/docs/rate-limits):
 *   Flash models  ~15 RPM / 1,500 RPD
 *   Pro models    ~2  RPM /   50 RPD
 *   Exceeding any limit returns 429 RESOURCE_EXHAUSTED from Google.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM_BASE = "https://generativelanguage.googleapis.com";

const HOP_BY_HOP = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length", "accept-encoding",
]);

function forwardHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

function buildUpstreamUrl(req: NextRequest, path: string[] | undefined): string {
  const sub = (path ?? []).filter(Boolean).join("/");
  const url = new URL(`${UPSTREAM_BASE}/${sub}${req.nextUrl.search}`);
  // Hard guard: never leave the Google host.
  if (url.origin !== "https://generativelanguage.googleapis.com") {
    throw new Error("Refusing to proxy off-host target.");
  }
  return url.toString();
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-goog-api-key, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  // /api/gemini/health -> plain local health check, never touches Google
  if (path?.[0] === "health") {
    return Response.json({ ok: true, upstream: UPSTREAM_BASE });
  }
  return proxy(req, path, "GET");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  return proxy(req, path, "POST");
}

async function proxy(req: NextRequest, path: string[] | undefined, method: string) {
  let target: string;
  try {
    target = buildUpstreamUrl(req, path);
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: forwardHeaders(req.headers),
      ...(method === "GET"
        ? {}
        : { body: req.body, duplex: "half" as const }),
      cache: "no-store",
    } as RequestInit);
  } catch (err) {
    return Response.json(
      { error: "Could not reach upstream.", detail: String((err as Error)?.message ?? err), target },
      { status: 502 }
    );
  }

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
