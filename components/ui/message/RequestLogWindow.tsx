"use client";

import { useEffect, useRef, useState } from "react";

import {
  clearClientLogs,
  getClientLogs,
  installClientFetchLog,
} from "@/lib/clientRequestLog";
import type { RequestLogEntry } from "@/lib/requestLog";

/**
 * RequestLogWindow — live request feed for the "/log" command.
 *
 * Opened from the chat with "/log" (or the 📜 Request Logs menu button). Polls
 * GET /api/logs every ~1.2s and renders the entries written by the proxy
 * (method, real URL, path, IP, UA, referer), merged with the client-side fetch
 * hook (lib/clientRequestLog.ts) which adds the request payload and the
 * response status + body. Click a row to expand the full detail: real URL,
 * 📦 payload and 📨 response. The header shows the current count plus
 * refresh / clear / close actions. Draggable by its title bar (mouse + touch),
 * always-on-top, fixed bottom-right like the chat windows.
 */

interface ViewEntry {
  id: string;
  time: number;
  method: string;
  path: string;
  query: string;
  /** Real, absolute request URL. */
  url: string;
  ua: string;
  ip: string;
  referer: string;
  payload?: string;
  status?: number;
  resBody?: string;
}

interface Props {
  onClose: () => void;
}

const POLL_MS = 1200;

const METHOD_COLOR: Record<string, string> = {
  GET: "#31a24c",
  POST: "#0084ff",
  PUT: "#b45309",
  PATCH: "#b45309",
  DELETE: "#d93025",
  HEAD: "#6b7280",
  OPTIONS: "#6b7280",
};

function fmtTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function shortUa(ua: string): string {
  const m = ua.match(/^([^(/]*)\/([\d.]+)/);
  if (m) return `${m[1]} ${m[2]}`;
  return ua.slice(0, 40);
}

/** Pretty-print JSON when possible; otherwise return the raw text. */
function pretty(text?: string): string {
  if (!text) return "";
  const t = text.trim();
  if (!t) return "";
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

function statusColor(status?: number): string {
  if (!status) return "#8a8d91";
  if (status < 300) return "#31a24c";
  if (status < 400) return "#b45309";
  return "#d93025";
}

export default function RequestLogWindow({ onClose }: Props) {
  const [entries, setEntries] = useState<ViewEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 8, y: 80 });

  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/logs", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        ok: boolean;
        logs: RequestLogEntry[];
      };
      const serverLogs = data.logs ?? [];

      // Client-side captures: they carry the response (status + body) that the
      // proxy cannot see. Match them to server entries by x-request-log-id.
      const clientById = new Map(
        getClientLogs().map((c) => [c.logId, c] as const)
      );

      const merged: ViewEntry[] = [];
      for (const s of serverLogs) {
        const logId = s.logId;
        const c = logId ? clientById.get(logId) : undefined;
        if (c && logId) clientById.delete(logId);
        merged.push({
          id: s.id,
          time: s.time,
          method: s.method,
          path: s.path,
          query: s.query,
          url: s.url,
          ua: s.ua,
          ip: s.ip,
          referer: s.referer,
          payload: c?.payload || s.payload,
          status: c?.status,
          resBody: c?.resBody,
        });
      }
      // Client entries that never reached the server feed (e.g. it failed) —
      // still show them, enriched from the browser.
      for (const c of clientById.values()) {
        let path = c.url;
        let query = "";
        try {
          const u = new URL(c.url);
          path = u.pathname;
          query = u.search.replace(/^\?/, "");
        } catch {
          /* keep raw */
        }
        merged.push({
          id: c.logId,
          time: c.time,
          method: c.method,
          path,
          query,
          url: c.url,
          ua: navigator.userAgent,
          ip: "browser",
          referer: document.referrer || "",
          payload: c.payload || undefined,
          status: c.status || undefined,
          resBody: c.resBody || undefined,
        });
      }

      merged.sort((a, b) => b.time - a.time);
      setEntries(merged.slice(0, 300));
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }

  async function clear() {
    try {
      const res = await fetch("/api/logs", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "clear failed");
      return;
    }
    clearClientLogs();
    setEntries([]);
    setSelectedId(null);
  }

  useEffect(() => {
    // Start capturing browser-originated fetches (real URL + payload + res).
    installClientFetchLog();
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the moment the window/tab regains focus — background tabs throttle
  // setInterval (down to ~1/min), so a stale feed would otherwise persist even
  // though the proxy keeps logging new requests.
  useEffect(() => {
    function onFocus() {
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Dragging (mouse + touch), same approach as the chat windows ----
  useEffect(() => {
    const move = (clientX: number, clientY: number) => {
      if (!draggingRef.current) return;
      const off = offsetRef.current;
      const w = elRef.current?.offsetWidth ?? 480;
      const h = elRef.current?.offsetHeight ?? 340;
      setPos({
        x: Math.max(0, Math.min(clientX - off.x, window.innerWidth - w)),
        y: Math.max(0, Math.min(clientY - off.y, window.innerHeight - h)),
      });
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current) {
        e.preventDefault();
        move(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  function startDrag(clientX: number, clientY: number) {
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    offsetRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    setPos({ x: rect.left, y: rect.top });
    draggingRef.current = true;
  }

  const headerBtn: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    padding: 2,
    lineHeight: 1,
  };

  return (
    <div
      ref={elRef}
      className="backdrop-blur-md"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: 480,
        maxWidth: "calc(100vw - 16px)",
        height: 340,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 12,
        boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
        background: "rgba(255,255,255,0.97)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        zIndex: 9999,
      }}
    >
      {/* Header */}
      <div
        onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
        onTouchStart={(e) =>
          startDrag(e.touches[0].clientX, e.touches[0].clientY)
        }
        style={{
          background: "#1f2328",
          color: "#fff",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "move",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 14 }}>📜</span>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>
          Request Log{" "}
          <span style={{ opacity: 0.7, fontWeight: 400 }}>
            ({entries.length})
          </span>
        </span>
        <span style={{ opacity: 0.6, fontSize: 11 }}>
          {loading ? "…" : "live"}
        </span>
        <button
          title="Refresh now"
          onClick={() => void refresh()}
          style={headerBtn}
        >
          ⟳
        </button>
        <button title="Clear log" onClick={() => void clear()} style={headerBtn}>
          🗑
        </button>
        <button title="Close" onClick={onClose} style={headerBtn}>
          ✕
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "6px 12px",
            fontSize: 12,
            color: "#d93025",
            background: "#ffecec",
            borderBottom: "1px solid #f5c6c6",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Feed */}
      <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
        {entries.length === 0 && !loading && (
          <div
            style={{
              margin: "24px 12px",
              textAlign: "center",
              fontSize: 13,
              color: "#8a8d91",
            }}
          >
            No requests logged yet.
            <br />
            <span style={{ fontSize: 12 }}>
              Open a page, fire the chat/AI/QA or any /api call — each request
              passes through the proxy and shows up here. Click a row to see
              the real URL, payload and response.
            </span>
          </div>
        )}

        {entries.map((e) => {
          const methodColor = METHOD_COLOR[e.method] || "#6b7280";
          const pathAndQuery = e.query ? `${e.path}?${e.query}` : e.path;
          const open = selectedId === e.id;
          return (
            <div
              key={e.id}
              onClick={() => setSelectedId(open ? null : e.id)}
              style={{
                cursor: "pointer",
                borderBottom: "1px solid #f0f0f0",
                fontSize: 12,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              }}
            >
              {/* Row summary */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                  padding: "5px 8px",
                  background: open ? "#eef4ff" : "transparent",
                }}
              >
                <span style={{ color: "#8a8d91", flexShrink: 0, width: 52 }}>
                  {fmtTime(e.time)}
                </span>
                <span
                  style={{
                    color: methodColor,
                    fontWeight: 700,
                    flexShrink: 0,
                    width: 52,
                    textAlign: "center",
                  }}
                >
                  {e.method}
                </span>
                <span
                  style={{
                    color: "#1f2328",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={pathAndQuery}
                >
                  {pathAndQuery}
                </span>
                {e.status ? (
                  <span
                    style={{
                      color: statusColor(e.status),
                      fontWeight: 700,
                      flexShrink: 0,
                      width: 40,
                      textAlign: "center",
                    }}
                    title="Response status"
                  >
                    {e.status}
                  </span>
                ) : null}
                <span style={{ color: "#57606a", flexShrink: 0 }} title={e.ua}>
                  {e.ip || "local"}
                </span>
                <span
                  style={{ color: "#8a8d91", flexShrink: 0, maxWidth: 90 }}
                  title={e.ua}
                >
                  {shortUa(e.ua)}
                </span>
              </div>

              {/* DETAIL_PANEL */}
              {open && (
                <div
                  style={{
                    padding: "8px 10px",
                    margin: "2px 0",
                    background: "#f6f8fa",
                    border: "1px solid #d0d7de",
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    🔗 Request
                  </div>
                  <div
                    style={{ wordBreak: "break-all", marginBottom: 2 }}
                    title={e.url}
                  >
                    <span style={{ color: "#57606a" }}>URL&nbsp;&nbsp;&nbsp;</span>
                    <span style={{ color: "#0084ff" }}>
                      {e.url || e.path || pathAndQuery}
                    </span>
                  </div>
                  <div style={{ color: "#57606a" }}>
                    {fmtTime(e.time)} · {e.ip || "local"} · {shortUa(e.ua)}
                    {e.referer ? ` · from ${e.referer}` : ""}
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <span style={{ fontWeight: 700 }}>📦 Payload</span>
                    <pre
                      style={{
                        maxHeight: 180,
                        overflow: "auto",
                        margin: "4px 0",
                        fontSize: 11,
                        lineHeight: 1.4,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        background: "#f0f3f6",
                        padding: "6px 8px",
                        borderRadius: 6,
                        color: "#1f2328",
                      }}
                    >
                      {pretty(e.payload) || (
                        <em style={{ color: "#8a8d91" }}>(no body)</em>
                      )}
                    </pre>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <span style={{ fontWeight: 700 }}>
                      📨 Response{" "}
                      {e.status ? (
                        <span style={{ color: statusColor(e.status) }}>
                          ({e.status})
                        </span>
                      ) : (
                        <em style={{ color: "#8a8d91", fontWeight: 400 }}>
                          {" "}
                          — not captured (only browser-originated calls have it)
                        </em>
                      )}
                    </span>
                    {e.resBody ? (
                      <pre
                        style={{
                          maxHeight: 200,
                          overflow: "auto",
                          margin: "4px 0",
                          fontSize: 11,
                          lineHeight: 1.4,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          background: "#f0f3f6",
                          padding: "6px 8px",
                          borderRadius: 6,
                          color: "#1f2328",
                        }}
                      >
                        {pretty(e.resBody)}
                      </pre>
                    ) : null}
                  </div>
                </div>
              )}
              {/* END_DETAIL_PANEL */}
            </div>
          );
        })}
      </div>
    </div>
  );
}