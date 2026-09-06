// app/api/proxy/[[...path]]/route.ts
//
// Server-side URL relay for the /proxy mini-browser. Two entry shapes:
//
//   1) GET /api/proxy?url=<absolute-url>                     — direct jump
//   2) ANY /api/proxy/p/<base64url-token>/<rel-path><query>  — path-style relay
//
// Shape 2 is what keeps a whole site surfing inside the relay:
//
//   • the injected <base href="/api/proxy/p/<token>/"> makes RUNTIME-built
//     document-relative URLs (SPA routers, JS-created <img>/<script>) resolve
//     back into the relay;
//   • the injected runtime patch catches fetch / XHR / window.open /
//     setAttribute / clicks / form submits / history so JS-built ROOT-relative
//     ("/api/…") and absolute URLs also flow through the relay — a plain
//     <base> can never fix root-relative URLs, they would hit this app and
//     404 (the old "click → wrong page" bug);
//   • static href/src/action/… attributes are rewritten server-side.
//
// The token is base64url of the target's directory (origin + path up to the
// last "/"), e.g. https://en.wikipedia.org/wiki/ → "aHR0cHM6…". base64url
// contains no "/" and no "%", so it survives any pathname re-encoding between
// browser and handler. The OLD implementation percent-encoded the token
// (%2F…), which broke as soon as the framework decoded the pathname before
// this route ran — reconstruction produced "//" paths and wrong pages.
//
// The target page is fetched by the SERVER (the visitor's IP never touches
// the origin) and streamed back. Frame-blocking headers (X-Frame-Options,
// CSP frame-ancestors) are stripped so pages can render inside the
// mini-browser's <iframe>.
//
// LIMITATIONS (by design — this is a portfolio demo, not a VPN):
//   • Cookies/sessions are not forwarded, so logins won't persist.
//   • Sites that bot-block server IPs (Cloudflare challenges) show their
//     challenge page instead of content.
//   • WebSockets and hardcoded cross-origin URLs inside JS bundles are not
//     intercepted.

import { NextRequest, NextResponse } from "next/server";

import { clientIp, rememberProxyTarget } from "@/lib/proxyLast";
import { cookieHeaderFor, readSetCookies, storeCookies } from "@/lib/proxyCookies";

export const dynamic = "force-dynamic";

// Use undici's fetch directly for upstream requests: Next.js patches the
// global fetch for caching, which can drop Headers.getSetCookie() and even
// override redirect:"manual" — both are required for the cookie jar and the
// login redirect chains below. Falls back to the global fetch if undici is
// ever unavailable. (Lazy-loaded so there's no top-level await in this route.)
let upstreamFetch: typeof globalThis.fetch | null = null;
async function getUpstreamFetch(): Promise<typeof globalThis.fetch> {
  if (upstreamFetch) return upstreamFetch;
  try {
    const mod = await import("undici");
    if (mod?.fetch) {
      upstreamFetch = mod.fetch as unknown as typeof globalThis.fetch;
    }
  } catch {
    /* stay on the global fetch */
  }
  if (!upstreamFetch) upstreamFetch = globalThis.fetch;
  return upstreamFetch;
}

/* ------------------------------------------------------------------ *
 * Tokens — base64url(directory)                                       *
 * ------------------------------------------------------------------ */

/** origin + path up to the last "/" — the "directory" a URL lives in. */
function dirOf(abs: URL): string {
  return abs.origin + abs.pathname.replace(/[^/]*$/, "");
}

function encodeToken(dir: string): string {
  return Buffer.from(dir, "utf8").toString("base64url");
}

/** Accepts current base64url tokens and legacy percent-encoded ones. */
function decodeToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* fall through to legacy */
  }
  try {
    const legacy = decodeURIComponent(token);
    return /^https?:\/\//i.test(legacy) ? legacy : null;
  } catch {
    return null;
  }
}

/** Relay path (shape 2) for an absolute http(s) URL. */
function relayPathOf(abs: URL): string {
  const dir = dirOf(abs);
  return `/api/proxy/p/${encodeToken(dir)}/${abs.href.slice(dir.length)}`;
}

/** Resolve a raw attribute value against `dir`; null → leave it untouched. */
function toRelayPath(dir: string, raw: string): string | null {
  if (!raw) return null;
  if (/^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(raw)) return null;
  if (/^\/api\/proxy(\/|\?|$)/i.test(raw)) return null; // already relayed
  try {
    const abs = new URL(raw, dir);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    return relayPathOf(abs);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Request parsing                                                     *
 * ------------------------------------------------------------------ */

function parseTarget(
  request: NextRequest
): { ok: true; target: URL } | { ok: false; response: NextResponse } {
  const { pathname, search } = request.nextUrl;

  // Shape 2: /api/proxy/p/<token>/<rel-path><query>
  const PREFIX = "/api/proxy/p/";
  if (pathname.startsWith(PREFIX)) {
    const rest = pathname.slice(PREFIX.length);
    const slash = rest.indexOf("/");
    const token = slash === -1 ? rest : rest.slice(0, slash);
    const rel = slash === -1 ? "" : rest.slice(slash + 1);
    const base = token ? decodeToken(token) : null;
    if (!base) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Unknown relay path token" },
          { status: 400 }
        ),
      };
    }
    try {
      // new URL() (not string concatenation) — handles trailing slashes,
      // "../", root-relative and query-only refs; never yields "//" paths.
      return { ok: true, target: new URL(rel + search, base) };
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid relay path" },
          { status: 400 }
        ),
      };
    }
  }

  // Shape 1: /api/proxy?url=<absolute-url>
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing ?url= or /p/<token>/<path>" },
        { status: 400 }
      ),
    };
  }
  try {
    return { ok: true, target: new URL(raw) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid URL" }, { status: 400 }),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Rewriting helpers                                                   *
 * ------------------------------------------------------------------ */

/** Rewrite url(...) / @import references inside a CSS snippet. */
function rewriteCssUrls(css: string, dir: string): string {
  let out = css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, quote: string, value: string) => {
      const relayed = toRelayPath(dir, String(value).trim());
      return relayed ? `url(${quote}${relayed}${quote})` : match;
    }
  );
  out = out.replace(
    /@import\s+(['"])([^'"]+)\1/gi,
    (match, quote: string, value: string) => {
      const relayed = toRelayPath(dir, value.trim());
      return relayed ? `@import ${quote}${relayed}${quote}` : match;
    }
  );
  return out;
}

/** Rewrite a srcset list ("url 640w, url2 2x"). */
function rewriteSrcsetAttr(value: string, dir: string): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return "";
      const m = trimmed.match(/^(\S+)(\s+.*)?$/);
      if (!m) return trimmed;
      const relayed = toRelayPath(dir, m[1]);
      return `${relayed ?? m[1]}${m[2] ?? ""}`;
    })
    .filter(Boolean)
    .join(", ");
}

/** Rewrite an HTML document so every URL keeps flowing through the relay. */
function rewriteHtml(
  html: string,
  dir: string,
  token: string,
  targetHref: string
): string {
  // The page's own <base> would fight ours — drop it (its href was already
  // used as the resolution directory by the caller).
  html = html.replace(/<base\b[^>]*>/gi, "");

  // href/src/action/formaction/poster. The (?<=\s) lookbehind stops mid-word
  // matches — the old pattern turned formaction="…" into "form<relay>…".
  html = html.replace(
    /(?<=\s)(href|src|action|formaction|poster)\s*=\s*(["'])([^"']*)\2/gi,
    (match, attr: string, quote: string, value: string) => {
      const relayed = toRelayPath(dir, value);
      return relayed ? `${attr}=${quote}${relayed}${quote}` : match;
    }
  );

  // srcset — comma-separated "url descriptor" candidates.
  html = html.replace(
    /\bsrcset\s*=\s*(["'])([^"']*)\1/gi,
    (match, quote: string, value: string) => {
      const relayed = rewriteSrcsetAttr(value, dir);
      return relayed === value ? match : `srcset=${quote}${relayed}${quote}`;
    }
  );

  // <style> blocks + style="…" attributes → css url() references.
  html = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, open: string, css: string, close: string) =>
      open + rewriteCssUrls(css, dir) + close
  );
  html = html.replace(
    /\sstyle\s*=\s*(["'])([^"']*?)\1/gi,
    (match, quote: string, css: string) => {
      const rewritten = rewriteCssUrls(css, dir);
      return rewritten === css ? match : ` style=${quote}${rewritten}${quote}`;
    }
  );

  // Subresource-integrity hashes can't match relayed (rewritten) bytes — the
  // browser would refuse every script/stylesheet ("blank page" bug).
  html = html.replace(/\sintegrity\s*=\s*(["'])[^"']*\1/gi, "");

  // <meta http-equiv="refresh" content="N;url=…"> — keep redirects in-relay.
  html = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/http-equiv\s*=\s*["']?refresh["']?/i.test(tag)) return tag;
    return tag.replace(
      /\scontent\s*=\s*(["'])([^"']*)\1/i,
      (m, quote: string, content: string) => {
        const parts = content.match(/^([\d.\s]*;?\s*url\s*=\s*)(\S+?)\s*$/i);
        if (!parts) return m;
        const relayed = toRelayPath(dir, parts[2]);
        return relayed ? `content=${quote}${parts[1]}${relayed}${quote}` : m;
      }
    );
  });

  // Inject <base> + the runtime patch as the FIRST things inside <head> —
  // so they apply before any other element/script resolves a URL.
  const inject =
    `<base href="/api/proxy/p/${token}/">` + runtimeScript(dir, targetHref);
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + inject);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => m + inject);
  } else {
    html = inject + html;
  }

  return html;
}

/* ------------------------------------------------------------------ *
 * Injected runtime patch                                              *
 *                                                                     *
 * Runs inside every relayed page and catches URLs that only exist at  *
 * runtime (built by JS). Server-side rewriting can't see those, and a *
 * plain <base href> only fixes DOCUMENT-relative ones — root-relative *
 * ("/api/…") and absolute ones are rewritten here.                    *
 * ------------------------------------------------------------------ */

function runtimeScript(dir: string, targetHref: string): string {
  const base = JSON.stringify(dir).replace(/</g, "\\u003c");
  const target = JSON.stringify(targetHref).replace(/</g, "\\u003c");
  return `<script>(function(){
var BASE=${base},TARGET=${target},APP=location.origin;
var SKIP=/^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i;
if(window.__PROXY_RT__)return;window.__PROXY_RT__=true;
function b64(s){return btoa(unescape(encodeURIComponent(s))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")}
function relayed(raw){try{var a=new URL(String(raw),BASE);if(a.protocol!=="http:"&&a.protocol!=="https:")return null;if(a.origin===APP&&a.pathname.indexOf("/api/proxy")===0)return null;var d=a.origin+a.pathname.replace(/[^/]*$/,"");return"/api/proxy/p/"+b64(d)+"/"+a.href.slice(d.length)}catch(e){return null}}
function isRel(u){return String(u).indexOf("/api/proxy")===0}
function rwSrcset(v){var o=[];String(v).split(",").forEach(function(p){var t=p.trim();if(!t)return;var b=t.split(/\\s+/);var r=relayed(b[0]);if(r)b[0]=r;o.push(b.join(" "))});return o.join(", ")}
var _f=window.fetch;
if(_f)window.fetch=function(i,n){try{if(typeof i==="string"){var r=relayed(i);if(r)i=r}else if(i&&typeof i.url==="string"){var r2=relayed(i.url);if(r2)i=new Request(r2,i)}}catch(e){}return _f.call(window,i,n)};
try{var _o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){var a=Array.prototype.slice.call(arguments);try{if(a[1]&&!isRel(a[1])){var r=relayed(a[1]);if(r)a[1]=r}}catch(e){}return _o.apply(this,a)}}catch(e){}
var _w=window.open;
window.open=function(){try{if(arguments[0]&&!isRel(arguments[0])){var r=relayed(arguments[0]);if(r)arguments[0]=r}}catch(e){}return _w.apply(window,arguments)};
["pushState","replaceState"].forEach(function(m){var orig=History.prototype[m];History.prototype[m]=function(s,t,u){try{if(u&&!isRel(u)){var r=relayed(u);if(r)u=r}}catch(e){}return orig.call(this,s,t,u)}});
var UA={href:1,src:1,action:1,formaction:1,poster:1,"data-src":1,"data-href":1,"data-action":1,"data-url":1};
var _sa=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){try{var k=String(n).toLowerCase();if(UA[k]&&!isRel(v)&&!SKIP.test(v)){var r=relayed(v);if(r)v=r}else if(k==="srcset"&&!isRel(v)){v=rwSrcset(v)}}catch(e){}return _sa.call(this,n,v)};
/* reflected IDL setters (a.href=…, img.src=…, form.action=…) do NOT go through
   setAttribute — patch the common ones or JS-built elements escape the relay */
var PROPS=[[window.HTMLAnchorElement,"href"],[window.HTMLLinkElement,"href"],[window.HTMLImageElement,"src"],[window.HTMLScriptElement,"src"],[window.HTMLIFrameElement,"src"],[window.HTMLSourceElement,"src"],[window.HTMLTrackElement,"src"],[window.HTMLMediaElement,"src"],[window.HTMLEmbedElement,"src"],[window.HTMLObjectElement,"data"],[window.HTMLFormElement,"action"],[window.HTMLInputElement,"formAction"],[window.HTMLButtonElement,"formAction"]];
function patchProp(proto,prop){try{var d=Object.getOwnPropertyDescriptor(proto,prop);if(!d||!d.set||!d.configurable)return;Object.defineProperty(proto,prop,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){try{var s=String(v);if(!isRel(s)&&!SKIP.test(s)){var r=relayed(s);if(r)v=r}}catch(e){}d.set.call(this,v)}})}catch(e){}}
PROPS.forEach(function(p){if(p[0])patchProp(p[0].prototype,p[1])});
try{var _sub=HTMLFormElement.prototype.submit;HTMLFormElement.prototype.submit=function(){try{var raw=this.getAttribute("action")||"";if(!isRel(raw)){var r=relayed(raw||TARGET);if(r)this.setAttribute("action",r)}}catch(e){}return _sub.apply(this,arguments)}}catch(e){}
try{var _sb=navigator.sendBeacon&&navigator.sendBeacon.bind(navigator);if(_sb)navigator.sendBeacon=function(u,d){try{if(!isRel(u)){var r=relayed(u);if(r)u=r}}catch(e){}return _sb(u,d)}}catch(e){}
document.addEventListener("click",function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;var el=e.target;while(el&&el.nodeType===1&&el.nodeName.toUpperCase()!=="A")el=el.parentNode;if(!el||el.nodeType!==1)return;var raw=el.getAttribute("href");if(!raw||SKIP.test(raw)||isRel(raw))return;var r=relayed(raw);if(r)el.setAttribute("href",r)},true);
document.addEventListener("submit",function(e){var f=e.target;if(!f||f.nodeName!=="FORM"||e.defaultPrevented)return;var raw=f.getAttribute("action")||"";if(isRel(raw))return;var r=relayed(raw||TARGET);if(r)f.setAttribute("action",r)},true);
try{parent.postMessage({source:"proxy-frame",type:"navigated",url:TARGET},"*")}catch(e){}
})();
</script>`;
}

/* ------------------------------------------------------------------ *
 * Handler — GET/HEAD (links, assets) + POST/PUT/PATCH/DELETE (forms   *
 * and JS calls; the old route only exported GET, so submitting a form *
 * returned 405).                                                      *
 * ------------------------------------------------------------------ */

/** Decode an upstream text body honoring its declared charset. */
function decodeBody(buffer: ArrayBuffer, contentType: string): string {
  const charset =
    contentType.match(/charset\s*=\s*"?([\w-]+)"?/i)?.[1] || "utf-8";
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const parsed = parseTarget(request);
  if (!parsed.ok) return parsed.response;
  const target = parsed.target;

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http/https URLs are supported" },
      { status: 400 }
    );
  }

  const method = request.method.toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  let upstream: Response | null = null;
  try {
    // Manual redirect following so cookies survive the whole chain: with
    // redirect:"follow" undici discards intermediate responses — and login
    // flows (Google sign-in!) set cookies on 302 hops before landing.
    const ip = clientIp(request);
    let currentUrl = new URL(target.toString());
    let currentMethod = method;
    let currentBody: ArrayBuffer | undefined = body;

    for (let hop = 0; hop < 10; hop++) {
      const outHeaders: Record<string, string> = {
        "User-Agent":
          request.headers.get("user-agent") ||
          "Mozilla/5.0 (compatible; PortfolioProxy/1.0)",
        Accept:
          request.headers.get("accept") ||
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": request.headers.get("accept-language") || "en-US,en;q=0.9",
      };
      const hasBody =
        currentBody && currentBody.byteLength > 0 && currentMethod !== "GET" && currentMethod !== "HEAD";
      const requestType = request.headers.get("content-type");
      if (requestType && hasBody) outHeaders["Content-Type"] = requestType;
      // CSRF checks (Google/YouTube sign-in) validate Origin on POSTs — it
      // must be the TARGET's origin, not this app's.
      if (currentMethod !== "GET" && currentMethod !== "HEAD") {
        outHeaders["Origin"] = currentUrl.origin;
      }
      // Replay the visitor's stored cookies for this target host.
      const cookie = cookieHeaderFor(ip, currentUrl.hostname);
      if (cookie) outHeaders["Cookie"] = cookie;

      const res = await (await getUpstreamFetch())(currentUrl.toString(), {
        method: currentMethod,
        redirect: "manual",
        headers: outHeaders,
        body: hasBody ? currentBody : undefined,
        signal: AbortSignal.timeout(15000),
      });

      // Capture Set-Cookie at EVERY hop (the browser can't hold these — they
      // belong to the upstream domain — so the jar stores them server-side).
      const setCookies = readSetCookies(res.headers);
      if (setCookies.length) {
        storeCookies(ip, currentUrl.hostname, setCookies);
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) {
          upstream = res;
          break;
        }
        const next = new URL(location, currentUrl);
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          upstream = res;
          break;
        }
        // 303 always becomes GET; 301/302 downgrade POST to GET (browser
        // behavior); 307/308 preserve method + body.
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) && currentMethod === "POST")
        ) {
          currentMethod = "GET";
          currentBody = undefined;
        }
        currentUrl = next;
        continue;
      }

      upstream = res;
      break;
    }

    if (!upstream) throw new Error("too many redirects");
  } catch (error) {
    return NextResponse.json(
      {
        error: "Fetch failed (site unreachable, timeout, or blocked this server)",
        detail: String(error),
      },
      { status: 502 }
    );
  }
  if (!upstream) {
    return NextResponse.json(
      { error: "Fetch failed (redirect chain did not resolve)" },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") || "";
  // The relay follows redirects itself — report where we really landed.
  let finalUrl = target.toString();
  if (upstream.url && /^https?:/i.test(upstream.url)) {
    try {
      finalUrl = new URL(upstream.url).toString();
    } catch {
      /* keep target */
    }
  }

  // Remember the site this visitor is currently surfing — the root catch-all
  // fallback (app/[...proxyFallback]) uses it to rescue location-based
  // escapes whose referer was stripped, instead of 404-ing on this app.
  try {
    const upstreamOrigin = new URL(finalUrl).origin;
    if (upstreamOrigin !== request.nextUrl.origin) {
      rememberProxyTarget(clientIp(request), upstreamOrigin);
    }
  } catch {
    /* memory is best-effort */
  }

  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  if (/^[\x20-\x7E]*$/.test(finalUrl)) headers.set("X-Proxy-Target", finalUrl);
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);

  // HTML — rewrite so navigation + subresources all stay inside the relay.
  if (contentType.includes("text/html")) {
    const docDir = dirOf(new URL(finalUrl));
    const html0 = decodeBody(await upstream.arrayBuffer(), contentType);
    // If the page declares its own <base>, resolve against it.
    let dir = docDir;
    const origBase = html0.match(/<base\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1/i);
    if (origBase) {
      try {
        dir = new URL(origBase[2], docDir).toString();
      } catch {
        /* keep docDir */
      }
    }
    const html = rewriteHtml(html0, dir, encodeToken(dir), finalUrl);
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new NextResponse(html, { status: upstream.status, headers });
  }

  // CSS — rewrite url()/@import relative to the stylesheet's own directory,
  // so backgrounds/fonts/@imports keep flowing through the relay too.
  if (contentType.includes("text/css")) {
    const css = rewriteCssUrls(
      decodeBody(await upstream.arrayBuffer(), contentType),
      dirOf(new URL(finalUrl))
    );
    headers.set("Content-Type", "text/css; charset=utf-8");
    return new NextResponse(css, { status: upstream.status, headers });
  }

  // Everything else (images, js, json, pdf, …) — stream through untouched.
  const passthrough = upstream.body ?? (await upstream.arrayBuffer());
  headers.set("Content-Type", contentType || "application/octet-stream");
  return new NextResponse(passthrough, { status: upstream.status, headers });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
