// lib/requestLog.ts
//
// In-memory ring buffer for the request log middleware ("/log" viewer).
// Same global-singleton pattern as lib/online.ts: in dev the Next middleware
// and the /api/logs route handler run in the SAME Node process, so entries
// written by middleware.ts are readable by app/api/logs/route.ts.
//
// LIMITATION: on serverless platforms (Netlify/Vercel) middleware and API
// routes may run in separate processes, so a live in-memory feed is only
// reliable locally / on a server that keeps one process per request. This
// match the behaviour of the existing online-visitors counter.

export interface RequestLogEntry {
  id: string;
  /** Epoch ms when the request hit the middleware. */
  time: number;
  method: string;
  path: string;
  /** URL query string WITHOUT the leading "?". */
  query: string;
  /** Real, absolute request URL (https://host/path?query). */
  url: string;
  /** User-Agent header (raw). */
  ua: string;
  /** Client IP (x-forwarded-for first hop, else x-real-ip). */
  ip: string;
  /** Referer header (raw). */
  referer: string;
  /** Client-generated correlation id (echoed via x-request-log-id header). */
  logId?: string;
  /** Request body preview (proxy reads a clone; client hook reads a clone). */
  payload?: string;
  /** Response status code — only known once the client-side fetch hook
   *  observes it (the proxy cannot await the downstream response). */
  status?: number;
  /** Response body preview — captured by the client-side fetch hook. */
  resBody?: string;
  /** Where the entry came from. */
  source: "server" | "client";
}

/** How many entries we keep — bounds the /log feed. */
const MAX_ENTRIES = 300;

declare global {
  // eslint-disable-next-line no-var
  var __requestLog: RequestLogEntry[] | undefined;
}

const logs: RequestLogEntry[] = globalThis.__requestLog ?? [];
if (!globalThis.__requestLog) globalThis.__requestLog = logs;

function makeId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID().slice(0, 8);
    }
  } catch {
    /* crypto unavailable — fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Append one request entry (called from proxy.ts). */
export function pushRequestLog(
  entry: Omit<RequestLogEntry, "id" | "source">
): RequestLogEntry {
  const full: RequestLogEntry = { id: makeId(), source: "server", ...entry };
  logs.push(full);
  if (logs.length > MAX_ENTRIES) {
    logs.splice(0, logs.length - MAX_ENTRIES);
  }
  return full;
}

/** Latest-first snapshot for the viewer. */
export function getRequestLogs(): RequestLogEntry[] {
  return logs.slice().reverse();
}

export function clearRequestLogs(): void {
  logs.length = 0;
}