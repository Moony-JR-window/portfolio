"use client";

import { useEffect, useRef, useState } from "react";

/**
 * QaWindow — the pretty Excel QA window opened by the "/qa" chat command.
 *
 * Mirrors the free-floating / draggable / resizable behaviour of AIChatWindow,
 * but instead of an AI chat it is a QA tool that reuses the exact logic from
 * the standalone `excel_rename.py` (single-file, keep logic style):
 *   • Drop / upload a .xlsx / .xlsm workbook — QA runs automatically.
 *   • Every run is gated behind an access key (form field `key`, validated on
 *     the server by lib/qaKey.ts) — the testing key is "1234".
 *   • Pick the sheet + header row, click "Run QA".
 *   • The server unmerges every merged range and renames the Service_Name
 *     column to its canonical SERVICE key.
 *   • "✨ AI Fix" sends the file again to the AI agent (POST /api/qa/ai-fix),
 *     which compares every row with the correct reference template
 *     (excel_data/Wing Bank Regression Testcase Template
 *     1.5_unmerged_renamed.xlsx) and auto-corrects Service_Name, Sender
 *     account/type, Amount and Receiver account/type — with a per-fix report.
 *   • Preview Original vs Fixed side-by-side (tabs) and download the fixed
 *     workbook (`*_ai_fixed.xlsx` after an AI pass).
 */

/** Height of the sticky site header (site-header.tsx uses h-16 = 64px). */
const HEADER_HEIGHT = 64;
const MIN_W = 360;
const MIN_H = 440;
const EDGE_MARGIN = 8;
const MAX_FILE_MB = 20;

interface PreviewSet {
  headers: string[];
  rows: string[][];
}

interface QaData {
  fileName: string;
  sheetNames: string[];
  sheetName: string;
  headerRow: number;
  totalRows: number;
  previewRows: number;
  unmergedRanges: number;
  serviceCol: number | null;
  renameCount: number;
  original: PreviewSet;
  fixed: PreviewSet;
  fixedBase64: string;
}

/** One AI agent correction (row is 1-based within the data area). */
interface AiFixItem {
  row: number;
  column: string;
  from: string;
  to: string;
  reason: string;
  /** True when the agent AUTO-INPUT this previously-empty cell. */
  fill?: boolean;
}

/** AI agent verdict returned by POST /api/qa/ai-fix. */
interface AiInfo {
  available: boolean;
  checkedRows: number;
  suggested: number;
  applied: number;
  /** How many of the applied fixes were auto-inputs of empty cells. */
  filled?: number;
  summary: string;
  fixes: AiFixItem[];
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Shorten long cell values inside the AI report list. */
function trunc(value: string, n: number): string {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Scrollable table rendering a preview matrix. */
function PreviewTable({ data }: { data: PreviewSet }) {
  if (!data.headers.length) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#8a8d91", fontSize: 13 }}>
        Nothing to show for this sheet & header row.
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 220, overflow: "auto" }}>
      <table
        className="w-full"
        style={{
          borderCollapse: "collapse",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <thead>
          <tr>
            {data.headers.map((h, i) => (
              <th
                key={i}
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f0f3f6",
                  color: "#1f2328",
                  textAlign: "left",
                  padding: "6px 10px",
                  border: "1px solid #e2e7ec",
                  whiteSpace: "nowrap",
                  minWidth: 90,
                  zIndex: 1,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? "#fafbfc" : "#fff" }}>
              {data.headers.map((_, ci) => (
                <td
                  key={ci}
                  style={{
                    border: "1px solid #eef1f4",
                    padding: "5px 10px",
                    color: "#44506a",
                    whiteSpace: "nowrap",
                    maxWidth: 260,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
type ResizeDir = "e" | "s" | "se";

export default function QaWindow({ onClose }: { onClose: () => void }) {
  // ---- Window geometry (normal/restored mode) ----
  const [geo, setGeo] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const w = Math.min(560, vw - 2 * EDGE_MARGIN);
    const h = Math.min(620, vh - HEADER_HEIGHT - 2 * EDGE_MARGIN);
    return {
      x: Math.max(EDGE_MARGIN, vw - w - 24),
      y: Math.max(HEADER_HEIGHT + EDGE_MARGIN, vh - h - 96),
      w,
      h,
    };
  });
  const [maximized, setMaximized] = useState(false);

  const elRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const resizingRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // ---- QA state ----
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [headerRowStr, setHeaderRowStr] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QaData | null>(null);
  const [activeTab, setActiveTab] = useState<"original" | "fixed">("fixed");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // ---- Access-key gate (validated server-side by lib/qaKey.ts) ----
  const [accessKey, setAccessKey] = useState("");
  /** True when the window is asking the user for the key before running QA. */
  const [needsKey, setNeedsKey] = useState(false);

  // ---- AI Fix state (POST /api/qa/ai-fix) ----
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInfo, setAiInfo] = useState<AiInfo | null>(null);
  const [showAiReport, setShowAiReport] = useState(true);
  const [aiTouched, setAiTouched] = useState(false);

  // Esc leaves fullscreen while maximized; closes the window otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (maximized) setMaximized(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized, onClose]);

  // Revoke a stale object URL whenever a new result replaces it.
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);
  // ---- Dragging & resizing (mouse + touch), same approach as AIChatWindow ----
  useEffect(() => {
    const move = (clientX: number, clientY: number) => {
      if (draggingRef.current) {
        const off = dragOffsetRef.current;
        setGeo((g) => ({
          ...g,
          x: Math.max(
            EDGE_MARGIN,
            Math.min(clientX - off.x, window.innerWidth - g.w - EDGE_MARGIN)
          ),
          y: Math.max(
            EDGE_MARGIN,
            Math.min(clientY - off.y, window.innerHeight - g.h - EDGE_MARGIN)
          ),
        }));
      } else if (resizingRef.current) {
        const r = resizingRef.current;
        const dx = clientX - r.startX;
        const dy = clientY - r.startY;
        setGeo((g) => ({
          ...g,
          w: r.dir.includes("e")
            ? Math.min(Math.max(r.startW + dx, MIN_W), window.innerWidth - g.x - EDGE_MARGIN)
            : g.w,
          h: r.dir.includes("s")
            ? Math.min(Math.max(r.startH + dy, MIN_H), window.innerHeight - g.y - EDGE_MARGIN)
            : g.h,
        }));
      }
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current || resizingRef.current) {
        e.preventDefault();
        move(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onUp = () => {
      draggingRef.current = false;
      resizingRef.current = null;
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
    if (maximized) return;
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffsetRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    draggingRef.current = true;
  }

  function startResize(dir: ResizeDir, clientX: number, clientY: number) {
    if (maximized) return;
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    resizingRef.current = {
      dir,
      startX: clientX,
      startY: clientY,
      startW: rect.width,
      startH: rect.height,
    };
  }

  function acceptFile(next: File | null) {
    if (!next) return;
    const ext = (next.name.split(".").pop() || "").toLowerCase();
    if (!["xlsx", "xlsm"].includes(ext)) {
      setError("Unsupported file type. Please pick a .xlsx or .xlsm file.");
      return;
    }
    if (next.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File is too large — please pick one under ${MAX_FILE_MB} MB.`);
      return;
    }
    setError(null);
    setData(null);
    setDownloadUrl(null);
    setSheetNames([]);
    setSelectedSheet("");
    setFile(next);
    setAiInfo(null); // fresh file → previous AI report is obsolete
    setAiTouched(false);
    if (!accessKey.trim()) {
      // Key gate: do not hit the server without a key — ask the user first.
      setNeedsKey(true);
      setError("🔑 Enter the QA access key, then press Run QA.");
      return;
    }
    setNeedsKey(false);
    // Auto-run once on pick so sheets populate + the default sheet is already
    // processed (sheet "" = server picks the first sheet).
    void runQa(next, "");
  }
  async function runQa(fileArg?: File, sheetArg?: string) {
    const targetFile = fileArg ?? file;
    if (!targetFile) return;
    const key = accessKey.trim();
    if (!key) {
      setNeedsKey(true);
      setError("🔑 Enter the QA access key, then press Run QA.");
      return;
    }
    setNeedsKey(false);
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", targetFile);
      body.append("sheet", sheetArg ?? selectedSheet);
      body.append("headerRow", headerRowStr);
      body.append("key", key);

      const res = await fetch("/api/qa", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      } & QaData;

      if (!res.ok || !json.success) {
        setError(json.error || "QA failed. Please try again.");
        setData(null);
        return;
      }

      if (json.fixedBase64) {
        const bin = atob(json.fixedBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        setDownloadUrl(
          URL.createObjectURL(
            new Blob([bytes], {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            })
          )
        );
      }

      setSheetNames(json.sheetNames);
      setSelectedSheet(json.sheetName);
      // Reflect the auto-detected header row so the user sees where it landed.
      setHeaderRowStr(String(json.headerRow));
      setActiveTab("fixed");
      setData({
        fileName: json.fileName,
        sheetNames: json.sheetNames,
        sheetName: json.sheetName,
        headerRow: json.headerRow,
        totalRows: json.totalRows,
        previewRows: json.previewRows,
        unmergedRanges: json.unmergedRanges,
        serviceCol: json.serviceCol,
        renameCount: json.renameCount,
        original: json.original,
        fixed: json.fixed,
        fixedBase64: json.fixedBase64,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * "✨ AI Fix" — send the (already unmerged/renamed) workbook through
   * POST /api/qa/ai-fix so the AI agent compares it with the correct
   * reference template and auto-applies corrections to Service_Name,
   * Sender account/type, Amount and Receiver account/type.
   */
  async function runAiFix() {
    if (!file) return;
    const key = accessKey.trim();
    if (!key) {
      setNeedsKey(true);
      setError("🔑 Enter the QA access key, then press ✨ AI Fix.");
      return;
    }
    setNeedsKey(false);
    setAiBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("sheet", selectedSheet);
      body.append("headerRow", headerRowStr);
      body.append("key", key);

      const res = await fetch("/api/qa/ai-fix", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        ai?: AiInfo;
      } & QaData;

      if (!res.ok || !json.success) {
        setError(json.error || "AI Fix failed. Please try again.");
        return;
      }

      if (json.fixedBase64) {
        const bin = atob(json.fixedBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        setDownloadUrl(
          URL.createObjectURL(
            new Blob([bytes], {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            })
          )
        );
      }

      setSheetNames(json.sheetNames);
      setSelectedSheet(json.sheetName);
      setHeaderRowStr(String(json.headerRow));
      setActiveTab("fixed");
      setData({
        fileName: json.fileName,
        sheetNames: json.sheetNames,
        sheetName: json.sheetName,
        headerRow: json.headerRow,
        totalRows: json.totalRows,
        previewRows: json.previewRows,
        unmergedRanges: json.unmergedRanges,
        serviceCol: json.serviceCol,
        renameCount: json.renameCount,
        original: json.original,
        fixed: json.fixed,
        fixedBase64: json.fixedBase64,
      });
      setAiInfo(
        json.ai ?? {
          available: false,
          checkedRows: 0,
          suggested: 0,
          applied: 0,
          summary: "",
          fixes: [],
        }
      );
      setAiTouched(true);
      setShowAiReport(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setAiBusy(false);
    }
  }

  const windowStyle: React.CSSProperties = maximized
    ? {
        position: "fixed",
        top: HEADER_HEIGHT,
        left: 0,
        width: "100vw",
        height: `calc(100vh - ${HEADER_HEIGHT}px)`,
        borderRadius: 0,
      }
    : {
        position: "fixed",
        left: geo.x,
        top: geo.y,
        width: geo.w,
        height: geo.h,
        borderRadius: 12,
      };

  const gripStyle = (cursor: string): React.CSSProperties => ({
    position: "absolute",
    zIndex: 10,
    cursor: maximized ? "default" : cursor,
    touchAction: "none",
  });

  return (
    <div
      ref={elRef}
      className="backdrop-blur-md"
      style={{
        ...windowStyle,
        boxShadow: "0 8px 28px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "rgba(255,255,255,0.96)",
        zIndex: 9999,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <style>{`@keyframes qa-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Title bar (drag handle) */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          startDrag(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
        style={{
          background: "linear-gradient(135deg, #10b981, #14b8a6, #06b6d4)",
          color: "#fff",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          userSelect: "none",
          touchAction: "none",
          cursor: maximized ? "default" : "grab",
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>📊 Excel QA</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>
            Unmerge + rename · 🤖 AI Fix vs reference template · type /qa ·
            Esc to close
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setMaximized((m) => !m)}
            title={maximized ? "Restore size" : "Maximize (full page under header)"}
            style={iconBtnStyle}
          >
            {maximized ? "❐" : "⛶"}
          </button>
          <button onClick={onClose} title="Close" style={iconBtnStyle}>
            ✕
          </button>
        </div>
      </div>
      {/* Drop zone / file input */}
      <div
        style={{
          padding: 12,
          borderBottom: "1px solid #eee",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#3f4750",
          }}
        >
          🔑 Access key
          <input
            type="password"
            value={accessKey}
            onChange={(e) => {
              setAccessKey(e.target.value);
              if (e.target.value.trim()) {
                setNeedsKey(false);
                setError(null);
              }
            }}
            placeholder="Required — this window is key-protected"
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
          />
        </label>
        {needsKey && (
          <div style={{ fontSize: 11, color: "#d1242f" }}>
            🔑 Enter the access key to run QA on this file.
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm"
          hidden
          onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0] ?? null);
          }}
          style={{
            border: `2px dashed ${dragOver ? "#10b981" : "#c8d2dc"}`,
            borderRadius: 10,
            background: dragOver ? "#ecfdf5" : "#f7f9fb",
            padding: "18px 12px",
            textAlign: "center",
            cursor: "pointer",
            transition: "border-color .15s, background .15s",
          }}
        >
          <div style={{ fontSize: 22 }}>{file ? "📄" : "📥"}</div>
          {file ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#1f2328" }}>
                {file.name}
              </div>
              <div style={{ fontSize: 11, color: "#8a8d91" }}>
                {formatBytes(file.size)} · click to replace
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#1f2328" }}>
                Drop your Excel file here, or click to browse
              </div>
              <div style={{ fontSize: 11, color: "#8a8d91" }}>
                .xlsx / .xlsm · up to {MAX_FILE_MB} MB · 🔑 key-protected
              </div>
            </div>
          )}
        </div>

        {file && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3f4750" }}>
              Sheet:
              <select
                value={selectedSheet}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedSheet(v);
                  // Auto re-run QA for the newly selected sheet.
                  void runQa(file, v);
                }}
                disabled={!sheetNames.length}
                style={inputStyle}
              >
                {!sheetNames.length ? (
                  <option value="">Sheet names load after running QA</option>
                ) : (
                  sheetNames.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3f4750" }}>
              Header row:
              <input
                type="number"
                min={1}
                value={headerRowStr}
                onChange={(e) => setHeaderRowStr(e.target.value)}
                style={{ ...inputStyle, width: 64 }}
              />
            </label>

            <button
              onClick={() => void runQa(file, selectedSheet)}
              disabled={busy || aiBusy}
              style={{
                marginLeft: "auto",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy || aiBusy ? "default" : "pointer",
                background:
                  busy || aiBusy
                    ? "#9fb0be"
                    : "linear-gradient(135deg,#10b981,#06b6d4)",
                color: "#fff",
              }}
            >
              {busy ? "Running…" : "Run QA"}
            </button>

            <button
              onClick={() => void runAiFix()}
              disabled={busy || aiBusy || !file}
              title="AI agent compares your sheet with the correct reference template and auto-fixes Service_Name, Sender account, Amount, Receiver account"
              style={{
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy || aiBusy || !file ? "default" : "pointer",
                background:
                  busy || aiBusy || !file
                    ? "#b6a8e8"
                    : "linear-gradient(135deg,#8b5cf6,#6366f1)",
                color: "#fff",
              }}
            >
              {aiBusy ? "🤖 AI checking…" : "✨ AI Fix"}
            </button>
          </div>
        )}

        {error && (
          <div
            style={{
              fontSize: 12,
              color: "#d1242f",
              background: "#ffecec",
              border: "1px solid #ffd2d2",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            ⚠️ {error}
          </div>
        )}
      </div>
      {/* Results */}
      {busy && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "#0ea5a4",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "2px solid #0ea5a4",
              borderTopColor: "transparent",
              animation: "qa-spin 0.8s linear infinite",
            }}
          />
          Fixing ...
        </div>
      )}

      {aiBusy && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "#6366f1",
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "2px solid #6366f1",
              borderTopColor: "transparent",
              animation: "qa-spin 0.8s linear infinite",
            }}
          />
          <div style={{ fontWeight: 600 }}>🤖 AI agent is checking your file…</div>
          <div style={{ fontSize: 12, color: "#6b7280", maxWidth: 420, textAlign: "center" }}>
            Comparing every row with the correct reference template —
            Service_Name, Sender account, Amount, Receiver account. This can
            take up to a minute.
          </div>
        </div>
      )}

      {!busy && !aiBusy && data && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px" }}>
            {statChip("Sheets", data.sheetNames.length)}
            {statChip("Rows (fixed)", data.totalRows)}
            {statChip("Unmerged", data.unmergedRanges)}
            {statChip(
              "Service_Name renamed",
              data.serviceCol === null ? "column not found" : data.renameCount
            )}
          </div>

          {/* ---- AI agent report ---- */}
          {aiInfo && (
            <div
              style={{
                margin: "0 14px 10px",
                border: `1px solid ${aiInfo.available && aiInfo.applied > 0 ? "#c7d2fe" : "#e2e8f0"}`,
                background:
                  aiInfo.available && aiInfo.applied > 0 ? "#eef2ff" : "#f8fafc",
                borderRadius: 10,
                padding: "10px 12px",
                flexShrink: 0,
              }}
            >
              <div
                onClick={() => setShowAiReport((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4338ca" }}>
                  🤖 AI Agent report
                </span>
                {aiInfo.available ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#4338ca",
                      background: "#e0e7ff",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {aiInfo.applied} of {aiInfo.suggested} fixes applied
                    {aiInfo.filled ? ` · ✨ ${aiInfo.filled} auto-filled` : ""}{" "}
                    · {aiInfo.checkedRows} rows checked
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#92400e",
                      background: "#fef3c7",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    AI unavailable — rule-based fixes only
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>
                  {showAiReport ? "▾" : "▸"}
                </span>
              </div>

              {showAiReport && (
                <>
                  {aiInfo.summary && (
                    <div style={{ fontSize: 12, color: "#374151", margin: "6px 0 8px" }}>
                      {aiInfo.summary}
                    </div>
                  )}
                  {aiInfo.fixes.length > 0 && (
                    <div
                      style={{
                        maxHeight: 150,
                        overflowY: "auto",
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                      }}
                    >
                      {aiInfo.fixes.map((f, i) => (
                        <div
                          key={`${f.row}-${f.column}-${i}`}
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "baseline",
                            gap: 6,
                            padding: "6px 10px",
                            borderTop: i === 0 ? "none" : "1px solid #f1f5f9",
                            fontSize: 12,
                          }}
                        >
                          <strong style={{ color: "#111827" }}>
                            Row {f.row}
                          </strong>
                          <code
                            style={{
                              background: "#f1f5f9",
                              borderRadius: 4,
                              padding: "1px 5px",
                              fontSize: 11,
                            }}
                          >
                            {f.column}
                          </code>
                          {f.fill && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#6d28d9",
                                background: "#ede9fe",
                                borderRadius: 999,
                                padding: "1px 6px",
                              }}
                            >
                              ✨ auto-filled
                            </span>
                          )}
                          <span style={{ color: "#9ca3af", wordBreak: "break-all" }}>
                            {trunc(f.from, 40) || "(empty)"}
                          </span>
                          <span style={{ color: "#6b7280" }}>→</span>
                          <strong
                            style={{ color: "#047857", wordBreak: "break-all" }}
                          >
                            {trunc(f.to, 40)}
                          </strong>
                          <span style={{ color: "#6b7280", flexBasis: "100%", fontSize: 11 }}>
                            {trunc(f.reason, 110)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {aiInfo.available && aiInfo.applied === 0 && (
                    <div style={{ fontSize: 12, color: "#047857", marginTop: 4 }}>
                      ✓ No AI corrections needed — rows match the reference.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 4, padding: "0 14px" }}>
            {(["original", "fixed"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  border: "none",
                  borderRadius: "8px 8px 0 0",
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: activeTab === tab ? "#eef7f6" : "transparent",
                  color: activeTab === tab ? "#0f766e" : "#57606a",
                  borderBottom:
                    activeTab === tab ? "2px solid #10b981" : "2px solid transparent",
                }}
              >
                {tab === "original" ? "Original" : "✅ Fixed"}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "0 14px 14px", minHeight: 0 }}>
            <PreviewTable data={activeTab === "original" ? data.original : data.fixed} />
            <div
              style={{
                fontSize: 11,
                color: "#8a8d91",
                textAlign: "center",
                paddingTop: 8,
              }}
            >
              Preview shows first {data.previewRows} data row
              {data.previewRows === 1 ? "" : "s"} — full workbook is exported.
              <br />
              Original = file as uploaded (merged cells blank) · Fixed =
              unmerged + renamed.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 12,
              borderTop: "1px solid #eee",
              flexShrink: 0,
            }}
          >
            {downloadUrl ? (
              <a
                href={downloadUrl}
                download={downloadName(data.fileName, aiTouched)}
                style={{
                  textDecoration: "none",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "linear-gradient(135deg,#10b981,#06b6d4)",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ⬇️ {downloadName(data.fileName, aiTouched)}
              </a>
            ) : (
              <span style={{ fontSize: 12, color: "#8a8d91" }}>
                Fixed workbook is ready — check the preview then download.
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#8a8d91" }}>
              {aiTouched
                ? "🤖 AI-corrected against the reference template"
                : "Logic matches excel_rename.py"}
            </span>
          </div>
        </div>
      )}
      {/* Resize grips — hidden while maximized */}
      {!maximized && (
        <>
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("e", e.clientX, e.clientY);
            }}
            onTouchStart={(e) => startResize("e", e.touches[0].clientX, e.touches[0].clientY)}
            style={{ ...gripStyle("ew-resize"), top: 44, bottom: 14, right: 0, width: 6 }}
          />
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("s", e.clientX, e.clientY);
            }}
            onTouchStart={(e) => startResize("s", e.touches[0].clientX, e.touches[0].clientY)}
            style={{ ...gripStyle("ns-resize"), left: 44, right: 14, bottom: 0, height: 6 }}
          />
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("se", e.clientX, e.clientY);
            }}
            onTouchStart={(e) => startResize("se", e.touches[0].clientX, e.touches[0].clientY)}
            style={{ ...gripStyle("nwse-resize"), right: 0, bottom: 0, width: 18, height: 18 }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                d="M17 7 L7 17 M17 12 L12 17"
                stroke="#9fd4c8"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid #d0d7de",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 12,
  background: "#fff",
  color: "#1f2328",
  outline: "none",
};

function statChip(label: string, value: string | number) {
  return (
    <span
      key={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "#3f4750",
        background: "#eef4f3",
        border: "1px solid #d6e6e3",
        borderRadius: 999,
        padding: "4px 10px",
      }}
    >
      <span style={{ color: "#0f766e", fontWeight: 700 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {label}
    </span>
  );
}

function downloadName(fileName: string, aiFixed = false): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim() || "workbook";
  return aiFixed
    ? `${base}_ai_fixed.xlsx`
    : `${base}_unmerged_renamed.xlsx`;
}

const iconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
  fontSize: 15,
  padding: 2,
};