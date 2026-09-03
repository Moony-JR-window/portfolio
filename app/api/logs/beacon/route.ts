// app/api/logs/beacon/route.ts
//
// Internal sink for entries captured by proxy.ts. The proxy may run in a
// sandbox/worker with its OWN memory, so it forwards each captured request
// here instead of writing to a shared global — this route always runs inside
// the main app runtime, so the store it fills is the one GET /api/logs reads.
//
// Excluded from proxy logging via the matcher (api/logs* prefix), so beacons
// never appear in (or recurse into) the feed.

import { NextRequest, NextResponse } from "next/server";

import { pushRequestLog, type RequestLogEntry } from "@/lib/requestLog";

export const dynamic = "force-dynamic";

/** Coerce an untrusted JSON body into a safe log entry. */
function toEntry(raw: unknown): Omit<RequestLogEntry, "id" | "source"> | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : fallback;
  const time = typeof b.time === "number" ? b.time : Date.now();
  const method = str(b.method, "GET").toUpperCase().slice(0, 12);
  if (!method) return null;
  return {
    time,
    method,
    path: str(b.path, "/").slice(0, 512),
    query: str(b.query).slice(0, 1024),
    url: str(b.url).slice(0, 2048),
    ua: str(b.ua).slice(0, 512),
    ip: str(b.ip).slice(0, 64),
    referer: str(b.referer).slice(0, 512),
    logId: str(b.logId) || undefined,
    payload: str(b.payload) || undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    const entry = toEntry(raw);
    if (entry) pushRequestLog(entry);
  } catch {
    /* never fail the proxied request because of logging */
  }
  return new NextResponse(null, { status: 204 });
}