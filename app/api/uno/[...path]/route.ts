/**
 * app/api/agent/[...path]/route.ts
 *
 * Path-pass-through tunnel to NVIDIA NIM:
 *   POST https://moony-dev.vercel.app/api/agent/v1/chat/completions
 *     -> https://integrate.api.nvidia.com/v1/chat/completions
 *
 * Also works with the OpenAI Python SDK (which omits /v1 from base_url):
 *   POST .../api/agent/chat/completions
 *     -> https://integrate.api.nvidia.com/v1/chat/completions
 *
 * No key handling, no body parsing. Caller's Authorization header rides along.
 *
 * FIXES vs. the previous version:
 *   1. GET /api/agent/health used to PROXY to NVIDIA /v1/health (a 404).
 *      Health is now a separate route: app/api/agent/health/route.ts
 *      (or the /api/agent/healthz path below).
 *   2. GET with an empty path (bare /api/agent) is answered locally instead
 *      of fetching a bodyless GET upstream.
 *   3. POST with an empty path is rejected with 400 instead of POSTing to
 *      /v1 (which NVIDIA 404s on).
 *   4. Content-Type is forced for POST so a stale client header can't break
 *      the upstream call.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM_BASE = "https://api.unorouter.com/v1";
const UPSTREAM_ORIGIN = "https://api.unorouter.com";

/** Hop-by-hop headers that must not be copied between requests. */
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
  // Strip a leading "v1" if the caller included it, so we never get /v1/v1/...
  const normalized = sub.replace(/^v1\/?/, "");
  const url = new URL(`${UPSTREAM_BASE}/${normalized}${req.nextUrl.search}`);
  // Hard guard: never leave the NVIDIA host.
  if (url.origin !== UPSTREAM_ORIGIN) {
    throw new Error("Refusing to proxy off-host target.");
  }
  return url.toString();
}

function healthPayload() {
  return Response.json({
    ok: true,
    upstream: UPSTREAM_BASE,
    usage: "POST {this-url}/v1/chat/completions  or  /chat/completions (OpenAI SDK)",
  });
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

  // Health check answered LOCALLY — never proxied upstream.
  if (path?.length === 1 && (path[0] === "health" || path[0] === "healthz")) {
    return healthPayload();
  }

  // Bare /api/agent -> local info instead of a pointless upstream GET.
  if (!path || path.length === 0) {
    return healthPayload();
  }

  return proxy(req, path, "GET");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;

  // A POST must name an endpoint. /api/agent with no sub-path used to hit
  // https://integrate.api.nvidia.com/v1 and get a 404 back.
  if (!path || path.length === 0) {
    return Response.json(
      {
        error: "Missing endpoint path.",
        expected: "POST /api/agent/v1/chat/completions",
      },
      { status: 400 }
    );
  }

  return proxy(req, path, "POST");
}

async function proxy(req: NextRequest, path: string[] | undefined, method: string) {
  let target: string;
  try {
    target = buildUpstreamUrl(req, path);
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }

  const headers = forwardHeaders(req.headers);
  if (method !== "GET" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
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

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) outHeaders.set(key, value);
  });
  outHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
