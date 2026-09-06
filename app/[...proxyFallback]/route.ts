// app/[...proxyFallback]/route.ts
//
// FINAL safety net for the /proxy relay. This root catch-all runs ONLY for
// paths nothing else matched — i.e., requests that were about to become a
// Next.js 404 ("This page could not be found.").
//
// Why it exists: pages running inside the relay can navigate with
// window.location ("Location" is unforgeable — no script can intercept it) to
// ROOT-relative URLs like "/results?search_query=…". Without this route that
// request lands on the portfolio and 404s. The proxy.ts middleware already
// catches most escapes via the referer; this route closes the remaining gaps
// (stripped / origin-only referers) using lib/proxyLast.ts — the server-side
// memory of the site the visitor is currently surfing, refreshed by every
// relayed response.
//
// Genuine 404s (nothing relayed recently, no relayed referer) still return a
// normal 404 page, so portfolio behavior is unchanged.

import { NextRequest, NextResponse } from "next/server";

import { clientIp, lastProxyTarget } from "@/lib/proxyLast";

export const dynamic = "force-dynamic";

const RELAY_PREFIX = "/api/proxy/p/";

function b64urlDecode(token: string): string | null {
  try {
    const bin = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0))
    );
  } catch {
    return null;
  }
}

/** Relayed document this request came from (via referer), if identifiable. */
function relayedSourceOrigin(request: NextRequest): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  let ref: URL;
  try {
    ref = new URL(referer);
  } catch {
    return null;
  }
  const selfHosts = new Set(
    [request.nextUrl.host, request.headers.get("host")].filter(Boolean) as string[]
  );
  if (!selfHosts.has(ref.host)) return null;
  if (ref.pathname.startsWith(RELAY_PREFIX)) {
    const token = ref.pathname.slice(RELAY_PREFIX.length).split("/")[0];
    return token ? b64urlDecode(token) : null;
  }
  if (ref.pathname === "/api/proxy") {
    const target = ref.searchParams.get("url");
    return target ?? null;
  }
  return null;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const rel = pathname.replace(/^\/+/, "");

  // Chrome DevTools / tooling probes must never be hijacked into the relay.
  if (pathname.startsWith("/.well-known/")) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // 1) The referer identifies the relayed document this navigation came from.
  const fromReferer = relayedSourceOrigin(request);
  if (fromReferer) {
    try {
      const origin = new URL(fromReferer).origin;
      if (origin !== request.nextUrl.origin) {
        const token = Buffer.from(origin + "/", "utf8").toString("base64url");
        return NextResponse.redirect(
          new URL(`${RELAY_PREFIX}${token}/${rel}${search}`, request.nextUrl.origin),
          307
        );
      }
    } catch {
      /* fall through */
    }
  }

  // 2) No usable referer? Relay it to the site this visitor is currently
  //    surfing (fresh in memory) instead of 404-ing.
  const recent = lastProxyTarget(clientIp(request));
  if (recent && recent.origin !== request.nextUrl.origin) {
    return NextResponse.redirect(
      new URL(`${RELAY_PREFIX}${recent.originToken}/${rel}${search}`, request.nextUrl.origin),
      307
    );
  }

  // 3) Genuine 404 — keep the default look and feel.
  const html = `<!DOCTYPE html><html><head><title>404: This page could not be found</title><meta name="viewport" content="width=device-width"></head><body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#ededed;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:24px;margin:0 0 8px">404</h1><h2 style="font-size:14px;font-weight:400;margin:0">This page could not be found.</h2></div></body></html>`;
  return new NextResponse(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;