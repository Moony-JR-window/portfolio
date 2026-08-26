"use client";

import { useEffect, useRef, useState } from "react";

/**
 * QaWindow — the pretty Excel QA window opened by the "/qa" chat command.
 *
 * Mirrors the free-floating / draggable / resizable behaviour of AIChatWindow,
 * but instead of an AI chat it is a QA tool that reuses the exact logic from
 * the standalone `excel_rename.py` (single-file, keep logic style):
 *   • Upload a .xlsx / .xlsm workbook.
 *   • Pick the sheet + header row, click "Run QA".
 *   • The server unmerges every merged range and renames the Service_Name
 *     column to its canonical SERVICE key.
 *   • Preview Original vs Fixed side-by-side (tabs) and download the fixed
 *     workbook.
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

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
// Auto-run once on pick so sheets populate + the default sheet is already
    // processed (sheet "" = server picks the first sheet).
    void runQa(next, "");
  }
  async function runQa(fileArg?: File, sheetArg?: string) {
    const targetFile = fileArg ?? file;
    if (!targetFile) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", targetFile);
      body.append("sheet", sheetArg ?? selectedSheet);
      body.append("headerRow", headerRowStr);

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
            Unmerge + Service_Name rename · type /qa in chat · Esc to close
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
                .xlsx / .xlsm · up to {MAX_FILE_MB} MB
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
              disabled={busy}
              style={{
                marginLeft: "auto",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                background: busy ? "#9fb0be" : "linear-gradient(135deg,#10b981,#06b6d4)",
                color: "#fff",
              }}
            >
              {busy ? "Running…" : "Run QA"}
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
          Processing workbook…
        </div>
      )}

      {!busy && data && (
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
                download={downloadName(data.fileName)}
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
                ⬇️ {downloadName(data.fileName)}
              </a>
            ) : (
              <span style={{ fontSize: 12, color: "#8a8d91" }}>
                Fixed workbook is ready — check the preview then download.
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#8a8d91" }}>
              Logic matches excel_rename.py
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

function downloadName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim() || "workbook";
  return `${base}_unmerged_renamed.xlsx`;
}

const iconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
  fontSize: 15,
  padding: 2,
};