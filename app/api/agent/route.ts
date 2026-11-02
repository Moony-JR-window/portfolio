/**
 * app/api/agent/route.ts
 *
 * Pure pass-through tunnel. No key handling, no whitelist, no body parsing.
 *
 *   POST https://myappnextjs.com/api/agent
 *     ->  https://integrate.api.nvidia.com/v1/chat/completions
 *
 * Everything the client sends (headers + body) is forwarded as-is, and the
 * upstream response (JSON or SSE stream) is piped straight back.
 * The caller supplies its own Authorization: Bearer nvapi-... header.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM = "https://integrate.api.nvidia.com/v1"

/** Hop-by-hop headers that must not be copied between requests. */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

function forwardHeaders(req: Request): Headers {
  const out = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
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

export async function GET() {
  return Response.json({ ok: true, tunnel: UPSTREAM });
}

export async function POST(req: NextRequest) {
  let upstream: Response;

  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: forwardHeaders(req),
      body: req.body, // raw stream, never parsed
      duplex: "half", // required for streaming request bodies
      cache: "no-store",
    } as RequestInit);
  } catch (err) {
    return Response.json(
      { error: "Could not reach upstream.", detail: String((err as Error)?.message ?? err) },
      { status: 502 }
    );
  }

  // Pipe the upstream response straight through, untouched.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: (() => {
      const h = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) h.set(key, value);
      });
      h.set("Access-Control-Allow-Origin", "*");
      return h;
    })(),
  });
}
