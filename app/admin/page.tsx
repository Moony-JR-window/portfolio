"use client";
import { useEffect, useState } from "react";

type Entry = { id: string; slug: string; originalUrl: string; createdAt: string };

export default function Dashboard() {
  const [items, setItems] = useState<Entry[]>([]);
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [dark, setDark] = useState(false);

  const t = dark
    ? { bg: "#0E1015", surface: "#171A22", text: "#ECEEF3", muted: "#A3ABBA", border: "#2A2F3B", accent: "#9AA2FF", onAccent: "#0E1015", danger: "#FF8A8A" }
    : { bg: "#F4F5F8", surface: "#FFFFFF", text: "#14171F", muted: "#4B5565", border: "#E1E4EA", accent: "#4338CA", onAccent: "#FFFFFF", danger: "#B42318" };

  async function load() { const r = await fetch("/api/urls"); if (r.ok) setItems(await r.json()); }
  useEffect(() => { load(); }, []);

  async function addItem() {
    const s = slug.trim().toLowerCase();
    const u = url.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) { setError("Slug needs lowercase letters, numbers and single hyphens."); return; }
    if (items.some((i) => i.slug === s)) { setError("That slug is already in use."); return; }
    let ok = false; try { const parsed = new URL(u); ok = parsed.protocol === "http:" || parsed.protocol === "https:"; } catch {}
    if (!ok) { setError("Enter a full URL starting with http:// or https://."); return; }
    const r = await fetch("/api/urls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: s, originalUrl: u }) });
    if (r.ok) { setSlug(""); setUrl(""); setError(""); load(); } else { const d = await r.json(); setError(d.error || "Error"); }
  }

  async function del(id: string) { await fetch("/api/urls", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); load(); }

  function copy(txt: string, slug: string) { try { navigator.clipboard.writeText(txt); } catch {} setCopied(slug); setTimeout(() => setCopied(""), 1500); }

  const shown = items.filter((i) => !query || i.slug.includes(query.toLowerCase()) || i.originalUrl.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ background: t.bg, color: t.text, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px 64px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: t.accent, color: t.onAccent, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>Proxy URL Dashboard</h1>
              <p style={{ margin: "2px 0 0", fontSize: 14, color: t.muted }}>Map short slugs to destination URLs.</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ padding: "8px 14px", borderRadius: 999, background: t.surface, border: `1px solid ${t.border}`, fontSize: 13, fontWeight: 600, color: t.muted }}>{items.length} {items.length === 1 ? "proxy" : "proxies"}</div>
            <button onClick={() => setDark(!dark)} aria-label="toggle theme" style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${t.border}`, background: t.surface, color: t.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {dark ? "☀" : "☾"}
            </button>
          </div>
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Add a proxy</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: t.muted }}>Slug</label>
              <input value={slug} onChange={(e) => { setSlug(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") addItem(); }} placeholder="my-link" style={{ height: 46, boxSizing: "border-box", padding: "0 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14 }} />
            </div>
            <div style={{ flex: "2 1 320px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: t.muted }}>Destination URL</label>
              <input value={url} onChange={(e) => { setUrl(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") addItem(); }} placeholder="https://example.com/..." style={{ height: 46, boxSizing: "border-box", padding: "0 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14 }} />
            </div>
            <button onClick={addItem} style={{ height: 46, padding: "0 22px", borderRadius: 10, border: "none", background: t.accent, color: t.onAccent, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Add</button>
          </div>
          {error && <p style={{ margin: 0, color: t.danger, fontSize: 13 }}>{error}</p>}
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Proxies</h2>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." style={{ height: 36, padding: "0 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13 }} />
          </div>
          {shown.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: t.muted, fontSize: 15 }}>{items.length === 0 ? "No proxies yet. Add your first slug above." : "No proxies match your search."}</div>
          ) : (
            <div>
              {shown.map((i) => (
                <div key={i.id} style={{ padding: "16px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: t.accent, fontFamily: "JetBrains Mono, monospace" }}>{i.slug}</div>
                    <div style={{ fontSize: 13, color: t.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.originalUrl}</div>
                  </div>
                  <button onClick={() => copy(i.originalUrl, i.slug)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, cursor: "pointer" }}>{copied === i.slug ? "Copied" : "Copy"}</button>
                  <button onClick={() => del(i.id)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.danger, fontSize: 13, cursor: "pointer" }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
