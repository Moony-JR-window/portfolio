// proxy.ts
//
// Request logger for the "/log" viewer (Next.js 16 renamed the middleware.ts
// convention to proxy.ts — same API, new name). Every request that reaches the
// app is recorded (method, real URL, query, client IP, user-agent, referer,
// request-body preview) into lib/requestLog.ts — with a fire-and-forget push so
// it never slows the app. The UI then polls GET /api/logs to show the feed.
//
// The PROXY can only see the request, not the downstream response (NextResponse
// .next() is a pass-through), so response status/body are captured by the
// client-side fetch hook (lib/clientRequestLog.ts). The hook tags each request
// with an x-request-log-id header, echoed here as `logId`, so the UI can merge
// request-side + response-side data for the same call.
//
// Non-navigation noise is skipped: Next internals, static assets and the log
// viewer's own /api/logs polling (otherwise the feed is just itself).
//
// This file is ALSO the safety net for the /proxy relay: a page running inside
// the relay may navigate with window.location ("Location" is unforgeable in
// browsers — no script can intercept it) to a ROOT-relative URL like
// "/results?search_query=…". Without the net that request hits THIS app and
// shows the Next.js 404 ("This page could not be found."). The net recognizes
// such requests by their referer (a relayed document) and 307-redirects them
// back into the relay, resolving the path against the TARGET origin.

import { NextRequest, NextResponse } from "next/server";

import { pushRequestLog } from "./lib/requestLog";

export const config = {
  // Skip Next internals and the log viewer's own poll. Static assets are NOT
  // matcher-excluded anymore: assets requested by a relayed page must reach
  // the escape-net too; pure portfolio assets are skipped in code below.
  matcher: ["/((?!_next/|favicon.ico|api/logs).*)"],
};

/* ------------------------------------------------------------------ *
 * /proxy escape-net                                                   *
 * ------------------------------------------------------------------ */

const RELAY_PREFIX = "/api/proxy/p/";

/** The asset list the matcher used to exclude — keeps the log feed clean
 *  now that the matcher lets assets through (so the escape-net sees them). */
const STATIC_ASSET_RE =
  /\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|eot|otf|pdf|zip|gz|mp4|webm|ogg|mp3|wav|txt|xml|json)$/i;

/** base64url via Web APIs — the middleware may run on the Edge runtime. */
function b64urlEncode(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

/** Token of the relayed document a request came from (via referer), if any. */
function relayedSourceToken(request: NextRequest): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  let ref: URL;
  try {
    ref = new URL(referer);
  } catch {
    return null;
  }
  if (ref.origin !== request.nextUrl.origin) {
    // nextUrl.origin can be normalized by the framework (e.g. 127.0.0.1 →
    // localhost), so compare the referer against every host this request
    // claims for "is this one of ours" instead of strict origin equality.
    const selfHosts = new Set(
      [
        request.nextUrl.host,
        request.headers.get("host"),
        request.headers.get("x-forwarded-host"),
      ].filter(Boolean) as string[]
    );
    if (!selfHosts.has(ref.host)) return null;
  }
  if (ref.pathname.startsWith(RELAY_PREFIX)) {
    return ref.pathname.slice(RELAY_PREFIX.length).split("/")[0] || null;
  }
  // Shape-1 documents carry their target in ?url= — derive the origin token.
  if (ref.pathname === "/api/proxy") {
    const target = ref.searchParams.get("url");
    if (!target) return null;
    try {
      const abs = new URL(target);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
      return b64urlEncode(abs.origin + "/");
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * "Currently surfed site" memory (middleware-local, best effort)      *
 *                                                                     *
 * Every relayed request flows THROUGH this middleware, so it can      *
 * remember which target site the visitor is surfing right now. This   *
 * powers the escape-net fallback for navigations whose referer was    *
 * stripped — no cross-runtime shared memory needed.                   *
 * ------------------------------------------------------------------ */

let lastRelay: { originToken: string; origin: string; at: number } | null = null;
const LAST_RELAY_TTL_MS = 120_000;

function noteRelayActivity(request: NextRequest): void {
  const { pathname, searchParams } = request.nextUrl;
  let origin: string | null = null;
  if (pathname.startsWith(RELAY_PREFIX)) {
    const token = pathname.slice(RELAY_PREFIX.length).split("/")[0];
    const decoded = token ? b64urlDecode(token) : null;
    if (decoded) {
      try {
        origin = new URL(decoded).origin;
      } catch {
        origin = null;
      }
    }
  } else if (pathname === "/api/proxy") {
    const target = searchParams.get("url");
    if (target) {
      try {
        origin = new URL(target).origin;
      } catch {
        origin = null;
      }
    }
  }
  if (origin && origin !== request.nextUrl.origin) {
    lastRelay = { originToken: b64urlEncode(origin + "/"), origin, at: Date.now() };
  }
}

/** 307 escaped root-relative requests from relayed pages back into the relay. */
function escapeNet(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/proxy") || pathname.startsWith("/_next")) {
    return null; // already relayed / Next internals
  }
  const rel = pathname.replace(/^\/+/, "");

  // Branch 1 — the initiator told us exactly which relayed document it came
  // from (same-origin navigations send the full referer).
  const token = relayedSourceToken(request);
  if (token) {
    // The token encodes the document's DIRECTORY, but a root-relative escape
    // always means the target ORIGIN root — decode and re-derive it.
    const dir = b64urlDecode(token);
    let originToken = token;
    let origin: string | null = null;
    if (dir) {
      try {
        origin = new URL(dir).origin;
        originToken = b64urlEncode(origin + "/");
      } catch {
        /* keep token */
      }
    }
    // Never relay this app onto itself (someone proxying their own portfolio
    // would otherwise loop its own links through the relay).
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.redirect(
        new URL(`${RELAY_PREFIX}${originToken}/${rel}${search}`, request.nextUrl.origin),
        307
      );
    }
  }

  // Branch 2 — referer was stripped (some sites/flows do), but the request
  // was still initiated by one of OUR documents (sec-fetch-site: same-origin)
  // and this process recently relayed a site: bounce to that site's origin.
  // Portfolio-internal navigations always carry a referer and address-bar
  // entries report sec-fetch-site: none, so neither is hijacked here.
  if (
    lastRelay &&
    Date.now() - lastRelay.at < LAST_RELAY_TTL_MS &&
    lastRelay.origin !== request.nextUrl.origin &&
    request.headers.get("sec-fetch-site") === "same-origin" &&
    !request.headers.get("referer")
  ) {
    return NextResponse.redirect(
      new URL(`${RELAY_PREFIX}${lastRelay.originToken}/${rel}${search}`, request.nextUrl.origin),
      307
    );
  }

  return null;
}

/** First ~4 KB of a JSON/text request body — file uploads (multipart) are
 *  skipped (too big). Reads a CLONE so the downstream route still gets the
 *  body (the adapter passes a clonable stream). */
async function readBodyPreview(request: NextRequest): Promise<string> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) return "";
  if (["GET", "HEAD"].includes(request.method)) return "";
  try {
    const clone = request.clone();
    if (!clone.body) return "";
    const reader = clone.body.getReader();
    const cap = 4096;
    const parts: string[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const piece = new TextDecoder().decode(value);
      parts.push(piece);
      total += piece.length;
      if (total >= cap) break;
    }
    await reader.cancel().catch(() => {});
    return parts.join("").slice(0, cap);
  } catch {
    return "";
  }
}

async function logRequest(request: NextRequest): Promise<void> {
  const url = request.nextUrl.toString();
  const payload = await readBodyPreview(request);
  const entry = {
    time: Date.now(),
    method: request.method,
    path: request.nextUrl.pathname,
    query: request.nextUrl.search.replace(/^\?/, ""),
    url,
    ua: request.headers.get("user-agent") || "",
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "",
    referer: request.headers.get("referer") || "",
    logId: request.headers.get("x-request-log-id") || undefined,
    payload: payload || undefined,
  };

  // Forward the entry into the app runtime's store. The proxy may run in a
  // sandbox/worker with its OWN memory — a local write would never be seen by
  // GET /api/logs — so the beacon route (inside the app) does the storing.
  // The beacon is matcher-excluded, so it never recurses into the feed.
  try {
    await fetch(`${request.nextUrl.origin}/api/logs/beacon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Beacon unreachable — fall back to this runtime's memory so we don't
    // lose the entry entirely (in-process deployments read it fine).
    pushRequestLog(entry);
  }
}

export async function proxy(request: NextRequest) {
  // Remember which site the visitor is currently surfing (for the escape-net
  // fallback) — relayed requests pass through here on their way to the route.
  if (request.nextUrl.pathname.startsWith("/api/proxy")) {
    noteRelayActivity(request);
  }

  // 1) Escape-net first: a relayed page navigated to one of this app's paths
  //    (window.location is unpatchable) — bounce it into the relay instead of
  //    letting it 404 here.
  const escaped = escapeNet(request);
  if (escaped) {
    if (!STATIC_ASSET_RE.test(request.nextUrl.pathname)) await logRequest(request);
    return escaped;
  }

  // 2) Portfolio asset requests stay out of the log feed (old matcher rule).
  if (STATIC_ASSET_RE.test(request.nextUrl.pathname)) return NextResponse.next();

  // 3) Everything else: log it and pass it through.
  await logRequest(request);
  return NextResponse.next();
}