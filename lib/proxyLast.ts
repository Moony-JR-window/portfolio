// lib/proxyLast.ts
//
// Tiny server-side memory of the site each visitor is currently surfing
// through the /proxy relay. Written by the relay route on every upstream
// response, read by the root catch-all fallback route
// (app/[...proxyFallback]/route.ts) when a request was about to become a 404.
//
// Route handlers share one Node runtime, so a plain module-global works here
// (unlike middleware, which may run in a separate sandbox — that one keeps
// its own copy in proxy.ts).

import type { NextRequest } from "next/server";

const TTL_MS = 120_000;
const last = new Map<string, { originToken: string; origin: string; at: number }>();

/** base64url via Web APIs (edge-compatible, though this runs on Node). */
function b64urlEncode(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Best-effort visitor key: x-forwarded-for → x-real-ip → shared bucket. */
export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "*"
  );
}

export function rememberProxyTarget(ip: string, origin: string): void {
  if (!origin) return;
  last.set(ip, {
    originToken: b64urlEncode(origin + "/"),
    origin,
    at: Date.now(),
  });
  // keep the map tiny
  if (last.size > 500) {
    const now = Date.now();
    for (const [key, value] of last) {
      if (now - value.at > TTL_MS) last.delete(key);
    }
  }
}

export function lastProxyTarget(
  ip: string
): { originToken: string; origin: string } | null {
  const entry = last.get(ip);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    last.delete(ip);
    return null;
  }
  return entry;
}