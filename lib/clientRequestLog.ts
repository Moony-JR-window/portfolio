// lib/clientRequestLog.ts
//
// Client-side fetch hook for the "/log" viewer. Installed once (idempotent) by
// RequestLogWindow. It wraps window.fetch so that browser-originated requests
// can be shown with the FULL picture:
//   • the real, absolute URL,
//   • the request payload (body),
//   • the response status + body.
//
// The proxy (proxy.ts) cannot observe the downstream response, so this hook is
// the only way to capture "res" for JS-made calls. Each captured request is
// tagged with an `x-request-log-id` header, which the proxy echoes into the
// server-side log entry — the viewer uses that to merge request-side + response
// -side data for the same call.
//
// Only the current browser tab sees these entries (they never leave the page).

export interface ClientLogEntry {
  logId: string;
  time: number;
  method: string;
  /** Real, absolute URL. */
  url: string;
  /** Request body preview (JSON/text), "" when empty/skipped. */
  payload: string;
  status: number;
  /** Response body preview. */
  resBody: string;
}

const MAX_ENTRIES = 300;
const CAP = 4096;

const logs: ClientLogEntry[] = [];

export function getClientLogs(): ClientLogEntry[] {
  return logs.slice().reverse();
}

export function clearClientLogs(): void {
  logs.length = 0;
}

function makeLogId(): string {
  try {
    if (typeof crypto?.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function push(log: ClientLogEntry): void {
  logs.push(log);
  if (logs.length > MAX_ENTRIES) {
    logs.splice(0, logs.length - MAX_ENTRIES);
  }
}

function cap(str: string, limit = CAP): string {
  return str.length > limit ? str.slice(0, limit) + "\n… (truncated)" : str;
}

/** Best-effort preview of a request body (URLSearchParams/FormData/Blob/etc.). */
async function bodyOf(
  body: BodyInit | null | undefined
): Promise<string> {
  if (body == null) return "";
  try {
    if (typeof body === "string") return cap(body);
    if (body instanceof URLSearchParams) return cap(body.toString());
    if (body instanceof FormData) {
      const parts: string[] = [];
      for (const [k, v] of body.entries()) {
        if (typeof v === "string") parts.push(`${k}=${v}`);
        else parts.push(`${k}=<file ${(v as File).name || "?"} ${(v as File).size || 0}B>`);
      }
      return cap(parts.join("&"));
    }
    if (body instanceof Blob) {
      const text = await body.text();
      return cap(text);
    }
    if (body instanceof ArrayBuffer) {
      return cap(`<ArrayBuffer ${body.byteLength} bytes>`);
    }
    return cap(String(body));
  } catch {
    return "";
  }
}

/** Returns the init headers with a correlation id injected (mutation-safe). */
function withLogId(init?: RequestInit): { init: RequestInit; logId: string } {
  const logId = makeLogId();
  const headers = new Headers(init?.headers);
  headers.set("x-request-log-id", logId);
  return { init: { ...(init || {}), headers }, logId };
}

/** Wrap window.fetch once. Safe to call repeatedly — a no-op after the first. */
export function installClientFetchLog(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (window as { fetch: any }).fetch;
  if (original.__requestLogInstalled) return;

  const wrapped = (input: RequestInfo | URL, init?: RequestInit) => {
    // Never log the viewer's own polling (otherwise the feed is just itself).
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url.split("?")[0];
    if (
      path.includes("/api/logs") ||
      path.includes("/_next/") ||
      path.includes("favicon.ico")
    ) {
      return original(input, init);
    }

    const { init: tagged, logId } = withLogId(init);
    const startedAt = Date.now();

    let method: string;
    let url: string;
    if (typeof input === "string") {
      method = (tagged.method || "GET").toUpperCase();
      url = new URL(input, window.location.origin).toString();
    } else if (input instanceof URL) {
      method = (tagged.method || "GET").toUpperCase();
      url = input.toString();
    } else {
      method = (input.method || tagged.method || "GET").toUpperCase();
      url = input.url;
    }
    // Read the payload from the tagged init (the app's body is untouched —
    // bodyOf only reads, never rewinds/consumes the outgoing body).
    const payloadPromise: Promise<string> =
      typeof input === "string" || input instanceof URL
        ? bodyOf(tagged?.body)
        : input.body
          ? input.clone().text().then((t) => cap(t))
          : bodyOf(tagged?.body);

    const resPromise = original(input, tagged)
      .then(async (res: Response) => {
        let resBody = "";
        let status = 0;
        try {
          const clone = res.clone();
          status = res.status;
          const text = await clone.text();
          resBody = cap(text.length ? text : `<empty (${res.status})>`);
        } catch {
          status = res.status;
          resBody = "";
        }
        void payloadPromise.then((payload) => {
          push({ logId, time: startedAt, method, url, payload, status, resBody });
        });
        return res;
      })
      .catch(async (err: unknown) => {
        void payloadPromise.then((payload) => {
          push({
            logId,
            time: startedAt,
            method,
            url,
            payload,
            status: 0,
            resBody: `fetch error: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
        throw err;
      });

    return resPromise;
  };

  wrapped.__requestLogInstalled = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as { fetch: any }).fetch = wrapped;
}