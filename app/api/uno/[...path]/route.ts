/**
 * app/api/agent/[...path]/route.ts
 *
 * Path-pass-through tunnel to UnoRouter (OpenAI-compatible):
 *   POST https://moony-dev.vercel.app/api/agent/v1/chat/completions
 *     -> https://api.unorouter.com/v1/chat/completions
 *
 * Also works with the OpenAI Python SDK (which omits /v1 from base_url):
 *   POST .../api/agent/chat/completions
 *     -> https://api.unorouter.com/v1/chat/completions
 *
 * No key handling, no body parsing. Caller's Authorization header rides along.
 *
 * FIX in this version (the real cause of "Decompression failed
 * ERR__ERROR_FORMAT_PADDING_2"):
 *   content-encoding was being copied back to the client while upstream.body
 *   had ALREADY been decompressed by fetch(). The client then tried to gunzip
 *   plain JSON and threw. Same for content-length (wrong byte count after
 *   decompression) and vary (stale cache key). All three are now stripped.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM_BASE = "https://api.unorouter.com/v1";
const UPSTREAM_ORIGIN = "https://api.unorouter.com";

/**
 * Headers that must never be copied in either direction.
 *
 * - True hop-by-hop headers (connection, keep-alive, transfer-encoding...).
 * - content-length / content-encoding: fetch() decodes the body and may
 *   re-encode or chunk it, so the upstream values are simply wrong for us.
 * - accept-encoding: we let fetch negotiate its own decoding.
 * - host: must be the upstream host, not ours.
 * - connection-level + CDN headers (cf-ray, server, via) that describe a
 *   different hop and confuse clients/proxies.
 */
const STRIP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // --- decompression / length correctness ---
  "content-encoding",
  "content-length",
  "accept-encoding",
  // --- stale hop metadata ---
  "vary",
  "cf-ray",
  "cf-cache-status",
  "server",
  "via",
  "alt-svc",
  "set-cookie",
]);

function forwardHeaders(src: Headers, extra?: Headers): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) out.set(key, value);
  });
  extra?.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

/** Reject traversal / encoded-separator segments before building the URL. */
const BAD_SEGMENT = /[\\/%\x00-\x1f]|\.\./;

function buildUpstreamUrl(req: NextRequest, path: string[] | undefined): string {
  const segments = (path ?? []).filter(Boolean);
  for (const s of segments) {
    if (BAD_SEGMENT.test(s)) {
      throw new Error(`Refusing unsafe path segment: ${JSON.stringify(s)}`);
    }
  }
  const sub = segments.join("/");
  // Strip a leading "v1" if the caller included it, so we never get /v1/v1/...
  const normalized = sub.replace(/^v1\/?/, "");
  const url = new URL(`${UPSTREAM_BASE}/${normalized}${req.nextUrl.search}`);
  // Hard guard: never leave the UnoRouter host.
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

  // Health answered LOCALLY - never proxied upstream.
  if (path?.length === 1 && (path[0] === "health" || path[0] === "healthz")) {
    return healthPayload();
  }
  if (!path || path.length === 0) return healthPayload();

  return proxy(req, path, "GET");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;

  // A POST must name an endpoint.
  if (!path || path.length === 0) {
    return Response.json(
      { error: "Missing endpoint path.", expected: "POST /api/agent/v1/chat/completions" },
      { status: 400 }
    );
  }
  return proxy(req, path, "POST");
}

async function proxy(
  req: NextRequest,
  path: string[] | undefined,
  method: "GET" | "POST"
) {
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
      ...(method === "GET" ? {} : { body: req.body, duplex: "half" as const }),
      cache: "no-store",
    } as RequestInit);
  } catch (err) {
    return Response.json(
      {
        error: "Could not reach upstream.",
        detail: String((err as Error)?.message ?? err),
        target,
      },
      { status: 502 }
    );
  }

  // Buffer the body. This is the part that matters: once we have real bytes we
  // can emit a correct Content-Length and NO Content-Encoding, so the client
  // never tries to decompress already-decoded data.
  //
  // NOTE: typed as ArrayBuffer, not Uint8Array. Under TypeScript 5.7+ lib.dom
  // an ArrayBuffer-backed Uint8Array<ArrayBufferLike> is NOT assignable to
  // BodyInit, because BodyInit wants Uint8Array<ArrayBuffer> (a definite,
  // detached-safe buffer). Passing the buffer itself sidesteps the variance
  // problem entirely and is valid BodyInit in every TS version.
  let body: ArrayBuffer | null = null;
  try {
    body = await upstream.arrayBuffer();
  } catch (err) {
    return Response.json(
      {
        error: "Upstream body could not be read.",
        detail: String((err as Error)?.message ?? err),
        target,
      },
      { status: 502 }
    );
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) outHeaders.set(key, value);
  });
  outHeaders.set("content-length", String(body.byteLength));
  outHeaders.set("Access-Control-Allow-Origin", "*");
  outHeaders.set("Cache-Control", "no-store");

  // 204/304 must not carry a body.
  if (upstream.status === 204 || upstream.status === 304) {
    outHeaders.delete("content-length");
    return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
  }

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
