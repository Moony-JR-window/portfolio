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

import { NextRequest, NextResponse } from "next/server";

import { pushRequestLog } from "./lib/requestLog";

export const config = {
  // Skip Next internals, static assets and the log viewer's own poll.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/logs|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|mjs|woff2?|ttf|eot|otf|pdf|zip|gz|mp4|webm|ogg|mp3|wav|txt|xml|json)).*)",
  ],
};

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

export async function proxy(request: NextRequest) {
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

  return NextResponse.next();
}