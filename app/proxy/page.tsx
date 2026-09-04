"use client";

/**
 * /proxy — a mini "web browser" window.
 *
 * Renders any URL through the server-side relay (GET /api/proxy?url=…), so
 * the page is fetched by the SERVER, not the visitor's browser. Useful as a
 * portfolio demo of request relaying; NOT a real VPN — sites with heavy
 * JS/anti-bot checks may not render.
 *
 * URL bar, back/forward (iframe history via history.length) and quick-jump
 * chips. Styled to match the site's terminal / hacker aesthetic.
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

const QUICK_LINKS = [
  { label: "Groq Docs", url: "https://console.groq.com/docs/rate-limits" },
  { label: "Example", url: "https://example.com" },
  { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Proxy_server" },
];

export default function ProxyPage() {
  const [input, setInput] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback((url: string) => {
    let normalized = url.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    setActiveUrl(`/api/proxy?url=${encodeURIComponent(normalized)}`);
    setInput(normalized);
    setLoading(true);
  }, []);

  // Auto-load the ?url= query param on first render (deep-linkable).
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("url");
    if (fromQuery) load(fromQuery);
  }, [load]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    load(input);
  }

  return (
    <main
      style={{
        height: "100dvh",
        width: "100%",
        background: "linear-gradient(160deg, #05080d 0%, #0a1018 100%)",
        color: "#9fffcf",
        fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflow: "hidden",
      }}
    >
      <h1 style={{ fontSize: 18, letterSpacing: 2, color: "#41ff9c", margin: 0 }}>
        &gt;_ PROXY BROWSER <span style={{ color: "#5a7a68", fontSize: 12 }}>[server-side relay]</span>
      </h1>

      <form
        onSubmit={onSubmit}
        style={{ display: "flex", gap: 8, alignItems: "center" }}
      >
        <span style={{ color: "#41ff9c" }}>url&gt;</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="paste any website URL…"
          spellCheck={false}
          style={{
            flex: 1,
            background: "#0b141c",
            border: "1px solid #1f3a2e",
            borderRadius: 6,
            color: "#c8ffe4",
            padding: "8px 12px",
            fontFamily: "inherit",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            background: "#0f2a1c",
            border: "1px solid #41ff9c55",
            color: "#41ff9c",
            borderRadius: 6,
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13,
          }}
        >
          GO →
        </button>
        {activeUrl && (
          <>
            <a
              href={activeUrl}
              target="_blank"
              rel="noreferrer"
              title="Open the relayed page in a new tab (fixes sites that won't render in the frame)"
              style={{
                background: "#0b141c",
                border: "1px solid #e8c46a55",
                color: "#e8c46a",
                borderRadius: 6,
                padding: "8px 12px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              ↗ direct
            </a>
            <button
              type="button"
              onClick={() => setActiveUrl("")}
              style={{
                background: "transparent",
                border: "1px solid #5a7a6855",
                color: "#5a7a68",
                borderRadius: 6,
                padding: "8px 12px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            >
              ✕ close
            </button>
          </>
        )}
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        {QUICK_LINKS.map((q) => (
          <button
            key={q.url}
            onClick={() => load(q.url)}
            style={{
              background: "#0b141c",
              border: "1px solid #1f3a2e",
              color: "#9fffcf",
              borderRadius: 999,
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            {q.label}
          </button>
        ))}
        {loading && (
          <span style={{ fontSize: 12, color: "#e8c46a" }}>fetching via server…</span>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          border: "1px solid #1f3a2e",
          borderRadius: 10,
          overflow: "hidden",
          background: "#fff",
          position: "relative",
        }}
      >
        {activeUrl ? (
          <>
            <iframe
              ref={iframeRef}
              src={activeUrl}
              onLoad={() => setLoading(false)}
              title="Proxied page"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
              }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                background: "#05080dd9",
                color: "#5a7a68",
                fontSize: 11,
                padding: "3px 10px",
                fontFamily: "inherit",
                pointerEvents: "none",
              }}
            >
              blank page? heavy-SPA sites break inside the frame — use{" "}
              <span style={{ color: "#e8c46a" }}>↗ direct</span> to open the relayed page in a new tab
            </div>
          </>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "#0b141c",
              color: "#5a7a68",
              fontSize: 13,
              textAlign: "center",
              padding: 24,
            }}
          >
            <div>&gt; no page loaded</div>
            <div style={{ maxWidth: 460 }}>
              Pages are fetched by the server and relayed here — links and
              assets inside the page are rewritten to keep flowing through the
              proxy. Heavy-JS / anti-bot sites may not render. Not a VPN.
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
