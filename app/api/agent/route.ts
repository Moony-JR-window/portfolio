/**
 * app/api/agent/[...path]/route.ts
 *
 * Path-pass-through tunnel:
 *   POST https://moony-dev.vercel.app/api/agent/v1/chat/completions
 *     -> https://integrate.api.nvidia.com/v1/chat/completions
 *
 * No key handling, no body parsing. Caller's Authorization header rides along.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM_BASE = "https://integrate.api.nvidia.com/v1";

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

function buildUpstreamUrl(req: NextRequest, params: { path?: string[] }): string {
  const sub = (params.path ?? []).filter(Boolean).join("/");
  // Strip a leading "v1" if the caller included it, so we never get /v1/v1/...
  const normalized = sub.replace(/^v1\/?/, "");
  const url = new URL(`${UPSTREAM_BASE}/${normalized}${req.nextUrl.search}`);
  // Hard guard: never leave the NVIDIA host.
  if (url.origin !== "https://integrate.api.nvidia.com") {
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  // /api/agent/health -> plain health check
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
    target = buildUpstreamUrl(req, { path });
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: forwardHeaders(req.headers),
      // For GET there is no body; passing undefined keeps the fetch valid.
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