// lib/proxyCookies.ts
//
// Server-side cookie jar for the /proxy relay — what makes sign-in flows
// possible. Browsers can't store upstream cookies for relayed URLs (a
// Set-Cookie for youtube.com arriving from localhost is rejected), so the
// relay keeps them here instead:
//
//   • every upstream response's Set-Cookie headers are captured per visitor
//     (client IP) and per cookie domain;
//   • every upstream request gets a synthesized Cookie header for the target
//     host (exact or subdomain match);
//   • session/expiry bookkeeping is best-effort (demo grade).
//
// The jar lives in the route-handlers' Node runtime, shared across requests.

const TTL_MS = 24 * 60 * 60 * 1000; // keep entries ≤ 1 day

type Entry = { name: string; value: string; domain: string; expiresAt: number };

const jar = new Map<string, Map<string, Entry>>(); // visitorIp → ("domain|name" → cookie)

/** Store the Set-Cookie lines an upstream response sent for `host`. */
export function storeCookies(ip: string, host: string, setCookies: string[]): void {
  if (!setCookies.length) return;
  const bucket = jar.get(ip) ?? new Map<string, Entry>();
  for (const line of setCookies) {
    const segments = line.split(";");
    const pair = segments[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;

    let domain = host.toLowerCase();
    let expiresAt = Date.now() + TTL_MS; // session-ish default for the demo
    for (const attr of segments.slice(1)) {
      const eq2 = attr.indexOf("=");
      const key = (eq2 === -1 ? attr : attr.slice(0, eq2)).trim().toLowerCase();
      const val = eq2 === -1 ? "" : attr.slice(eq2 + 1).trim();
      if (key === "domain" && val) {
        domain = val.replace(/^\./, "").toLowerCase();
      } else if (key === "max-age" && val) {
        const secs = parseInt(val, 10);
        if (!Number.isNaN(secs)) expiresAt = secs <= 0 ? 0 : Date.now() + secs * 1000;
      } else if (key === "expires" && val) {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expiresAt = t;
      }
    }

    const key = `${domain}|${name}`;
    if (expiresAt <= Date.now()) bucket.delete(key);
    else bucket.set(key, { name, value, domain, expiresAt });
  }
  jar.set(ip, bucket);
}

/** Synthesize a Cookie header for an upstream request to `host`. */
export function cookieHeaderFor(ip: string, host: string): string | null {
  const bucket = jar.get(ip);
  if (!bucket || bucket.size === 0) return null;
  const target = host.toLowerCase();
  const now = Date.now();
  const parts: string[] = [];
  for (const [key, cookie] of bucket) {
    if (cookie.expiresAt <= now) {
      bucket.delete(key);
      continue;
    }
    if (target === cookie.domain || target.endsWith("." + cookie.domain)) {
      parts.push(`${cookie.name}=${cookie.value}`);
    }
  }
  return parts.length ? parts.join("; ") : null;
}

export function clearCookies(ip: string): void {
  jar.delete(ip);
}

/** Split a combined "set-cookie" header into individual cookies. */
function splitSetCookies(joined: string): string[] {
  // A new cookie starts at a comma followed by "name=" — but date values
  // ("Expires=Wed, 21 Oct …") contain commas too and must not split.
  return joined
    .split(/\s*,\s*(?=[^\s;,=]+\s*=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Read Set-Cookie headers robustly across runtimes/patches. */
export function readSetCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") {
    const list = h.getSetCookie();
    if (list && list.length) return list;
  }
  const joined = headers.get("set-cookie");
  return joined ? splitSetCookies(joined) : [];
}