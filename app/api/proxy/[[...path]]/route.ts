// app/api/proxy/[[...path]]/route.ts
//
// Server-side URL relay for the /proxy mini-browser. Two entry shapes:
//
//   1) GET /api/proxy?url=<absolute-url>          — direct jump
//   2) GET /api/proxy/p/<encoded-base>/<rel-path> — resolved by the injected
//      <base href>, so RUNTIME-built relative links (SPA routers, images
//      created by JS) also flow back through the relay.
//
// The target page is fetched by the SERVER (the visitor's IP never touches
// the origin) and streamed back. Frame-blocking headers (X-Frame-Options,
// CSP frame-ancestors) are stripped so the page can render inside the
// mini-browser's <iframe>. Static HTML href/src attributes are rewritten to
// absolute relay paths too.
//
// LIMITATIONS (by design — this is a portfolio demo, not a VPN):
//   • Only GET; forms, cookies and login flows are not forwarded.
//   • Regex-based rewriting: some SPAs still break.
//   • Sites that bot-block server IPs (Cloudflare challenges) will show their
//     challenge page instead of content.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Rewrite a possibly-relative target URL into an absolute relay URL. */
function toRelay(baseDir: string, raw: string): string | null {
  if (!raw || /^(#|data:|javascript:|mailto:|tel:)/i.test(raw)) return null;
  if (/^\/api\/proxy/i.test(raw)) return null; // already relayed
  try {
    let abs: string;
    try {
      abs = new URL(raw).toString(); // already absolute
    } catch {
      abs = new URL(raw, baseDir).toString();
    }
    if (!/^https?:/i.test(abs)) return null;
    return `/api/proxy?url=${encodeURIComponent(abs)}`;
  } catch {
    return null;
  }
}

/** URL of the target page up to its last "/" — used as the <base> directory. */
function baseDirOf(target: URL): string {
  const path = target.pathname;
  const dir = path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
  return target.origin + dir;
}

export async function GET(request: NextRequest) {
  const { pathname, searchParams, search } = request.nextUrl;

  // Shape 2: /api/proxy/p/<encoded-base-dir>/<remaining/path><query>
  const pathMatch = pathname.match(/^\/api\/proxy\/p\/([^/]+)(?:\/(.*))?$/);
  let rawUrl: string | null;
  if (pathMatch) {
    rawUrl =
      decodeURIComponent(pathMatch[1]) + "/" + (pathMatch[2] || "") + search;
  } else {
    rawUrl = searchParams.get("url");
  }

  if (!rawUrl) {
    return NextResponse.json({ error: "Missing ?url= or /p/<base>/path" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol)) {
    return NextResponse.json(
      { error: "Only http/https URLs are supported" },
      { status: 400 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          request.headers.get("user-agent") ||
          "Mozilla/5.0 (compatible; PortfolioProxy/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": request.headers.get("accept-language") || "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Fetch failed (site unreachable, timeout, or blocked this server)",
        detail: String(error),
      },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") || "";

  // Non-HTML (images, css, js, pdf, …) — stream through untouched.
  if (!contentType.includes("text/html")) {
    const headers = new Headers();
    headers.set("Content-Type", contentType || "application/octet-stream");
    headers.set("Cache-Control", "no-store");
    const body = upstream.body ? upstream.body : await upstream.arrayBuffer();
    return new NextResponse(body, { status: upstream.status, headers });
  }

  // HTML — rewrite static href/src attributes so navigation and subresources
  // stay inside the relay (runtime-built URLs are handled by the <base>).
  const dir = baseDirOf(target);
  let html = await upstream.text();

  const attrRe = /(href|src|action)\s*=\s*(["'])([^"']*)\2/gi;
  html = html.replace(attrRe, (match, attr: string, quote: string, value: string) => {
    const relayed = toRelay(dir, value);
    return relayed ? `${attr}=${quote}${relayed}${quote}` : match;
  });

  // Inject our <base>: relative URLs built at runtime resolve to
  // /api/proxy/p/<encoded dir>/<rel-path>, which this route decodes.
  html = html.replace(/<base\b[^>]*>/gi, "");
  html = html.replace(
    /<head([^>]*)>/i,
    `<head$1><base href="/api/proxy/p/${encodeURIComponent(dir)}/">`
  );

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  return new NextResponse(html, { status: upstream.status, headers });
}
