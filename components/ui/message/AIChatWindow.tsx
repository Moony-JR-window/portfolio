"use client";

import { useEffect, useRef, useState } from "react";

import AIResponse from "./AIResponse";
import { useTheme } from "@/hooks/useTheme";

/**
 * AIChatWindow — the dedicated chat UI opened by the "/ai" command.
 *
 * Moved out of the community chat (ChatWindow) so the AI gets its own window:
 *   • Free-floating and draggable by its title bar (mouse + touch).
 *   • Resizable — drag the right edge, bottom edge or bottom-right corner
 *     grip to scale it bigger or smaller.
 *   • "⛶ Max" button fills the whole page but stays BELOW the sticky site
 *     header (header height = h-16 = 64px). Clicking again (or pressing Esc)
 *     restores the previous size/position.
 *   • Typing "/exit" in its input returns it to normal: restores from
 *     maximized if maximized, otherwise closes the window.
 *   • 🖼️ Upload image — attaches a picture (≤4 MB) to the next question;
 *     it is sent to /api/ai as a base64 data URL for vision analysis.
 *   • 🎙️ Voice input — placeholder button that alerts "to be update".
 *
 * History is cached in localStorage with a 1-hour TTL, mirroring the old
 * inline behaviour. Answers come from the existing /api/ai endpoint and are
 * rendered with the shared <AIResponse /> markdown renderer.
 */

/** Height of the sticky site header (site-header.tsx uses h-16 = 64px). */
const HEADER_HEIGHT = 64;

const MIN_W = 320;
const MIN_H = 400;
const EDGE_MARGIN = 8;

interface AIChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  /** Optional data-URL preview of an image attached to this (user) message. */
  imageDataUrl?: string;
}

interface Props {
  /** When provided, this question is asked automatically right after opening. */
  initialQuestion?: string | null;
  onClose: () => void;
}

const CACHE_KEY = "moonydev_ai_chat_cache_v1";
const TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHED = 200; // keep the cache bounded

/** Max accepted image size for the upload button (base64 inflates ~33%). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

function loadCache(): AIChatMessage[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AIChatMessage[];
    const now = Date.now();
    return parsed.filter((m) => now - m.timestamp <= TTL_MS);
  } catch {
    return [];
  }
}

/** AI models offered by the chat's "select model" dropdown. */
export type AIChatModel =
  | "auto"
  | "openai/gpt-oss-120b"
  | "meta-llama/llama-4-scout-17b-16e-instruct"
  | "free:openai"
  | "free:mistral"
  | "oxalpha";

interface ModelOption {
  value: AIChatModel;
  label: string;
  short: string;
  hint: string;
}

/** Choices in the "select model" dropdown. `auto` = server default. */
export const MODEL_OPTIONS: ModelOption[] = [
  { value: "auto", label: "Auto (best available)", short: "Auto", hint: "Server picks the best working provider." },
  { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B", short: "GPT-OSS", hint: "General chat via the configured provider." },
  {
    value: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout (vision)",
    short: "Llama 4",
    hint: "Multimodal — also auto-selected for image questions.",
  },
  { value: "free:openai", label: "OpenAI (free)", short: "OpenAI", hint: "Keyless Pollinations — no API key needed." },
  { value: "free:mistral", label: "Mistral (free)", short: "Mistral", hint: "Keyless Pollinations — no API key needed." },
  {
    value: "oxalpha",
    label: "Oxalpha (keyless)",
    short: "Oxalpha",
    hint: "Keyless oxalpha.com chat — needs a session cookie or local Chrome.",
  },
];

const MODEL_STORAGE_KEY = "moonydev_ai_model";

function loadModel(): AIChatModel {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (raw && MODEL_OPTIONS.some((m) => m.value === raw)) {
      return raw as AIChatModel;
    }
  } catch {
    /* storage blocked — ignore */
  }
  return "auto";
}

type ResizeDir = "e" | "s" | "se";

export default function AIChatWindow({ initialQuestion, onClose }: Props) {
  // ---- Conversation state (cached in localStorage with a 1-hour TTL) ----
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");

  // ---- Model selection (persisted to localStorage) ----
  const [selectedModel, setSelectedModel] = useState<AIChatModel>(loadModel);
  const [showModel, setShowModel] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);

  // ---- Theme (synced with the portfolio site theme) ----
  const { theme, isDark, toggle: toggleTheme } = useTheme();

  // ---- Image attachment (sent with the next question) ----
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Window geometry (normal/restored mode) ----
  const [geo, setGeo] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const w = Math.min(430, vw - 2 * EDGE_MARGIN);
    const h = Math.min(560, vh - HEADER_HEIGHT - 2 * EDGE_MARGIN);
    return {
      x: Math.max(EDGE_MARGIN, vw - w - 24),
      y: Math.max(HEADER_HEIGHT + EDGE_MARGIN, vh - h - 96),
      w,
      h,
    };
  });
  const [maximized, setMaximized] = useState(false);

  const elRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const resizingRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // Restore cached history after mount — reading storage during render would
  // cause an SSR/CSR hydration mismatch.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    setMessages(loadCache());
    const q = initialQuestion?.trim();
    if (q) {
      void ask(q);
    } else {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Purge expired entries every minute while the window is open.
  useEffect(() => {
    const purge = () => {
      const now = Date.now();
      setMessages((prev) => {
        const kept = prev.filter((m) => now - m.timestamp <= TTL_MS);
        return kept.length === prev.length ? prev : kept;
      });
    };
    const id = setInterval(purge, 60_000);
    return () => clearInterval(id);
  }, []);

  // Persist history so the conversation survives reopen/reload (1h TTL).
  useEffect(() => {
    try {
      // Base64 images are far too big for localStorage — persist text only.
      const withoutImages = messages
        .slice(-MAX_CACHED)
        .map((m) => (m.imageDataUrl ? { ...m, imageDataUrl: undefined } : m));
      localStorage.setItem(CACHE_KEY, JSON.stringify(withoutImages));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [messages]);

  // Remember the chosen model across reopens / reloads.
  useEffect(() => {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
    } catch {
      /* storage unavailable — ignore */
    }
  }, [selectedModel]);

  // Close the model dropdown when clicking outside of it.
  useEffect(() => {
    if (!showModel) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setShowModel(false);
      }
    }
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [showModel]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, thinking]);

  // Auto-grow the input box while typing a long prompt.
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [draft]);

  // Esc leaves fullscreen ("back to normal") while maximized.
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  function pushMsg(
    role: AIChatMessage["role"],
    text: string,
    img?: string | null
  ) {
    const msg: AIChatMessage = {
      id: `aic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role,
      text,
      timestamp: Date.now(),
      ...(img ? { imageDataUrl: img } : {}),
    };
    setMessages((prev) => [...prev, msg]);
  }

  /** Ask the AI (optionally with an attached image) and append its answer. */
  async function ask(question: string, img?: string | null) {
    const q = question.trim();
    if (!q) return;

    pushMsg("user", q, img);
    setThinking(true);
    // The attachment has been consumed into the pushed message — reset composer.
    setImageDataUrl(null);
    setImageName(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
          message: q,
          model: selectedModel,
          ...(img ? { imageDataUrl: img } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string };
      pushMsg("assistant", data.reply || "I couldn't think of an answer. Try again!");
    } catch {
      pushMsg(
        "assistant",
        "⚠️ The free AI service is temporarily unavailable. Please try again."
      );
    } finally {
      setThinking(false);
    }
  }

  function handleSubmit() {
    const text = draft.trim();
    if ((!text && !imageDataUrl) || thinking) return;

    // An attached image goes straight to the AI (slash commands need plain text)
    if (imageDataUrl) {
      setDraft("");
      void ask(
        text ||
          "What do you see in this image? Describe it and answer helpfully.",
        imageDataUrl
      );
      return;
    }

    // Commands understood by the AI window
    if (text.startsWith("/")) {
      setDraft("");

      if (text.toLowerCase() === "/exit") {
        // Back to normal: un-maximize first; close when already normal.
        if (maximized) setMaximized(false);
        else onClose();
        return;
      }

      pushMsg("assistant", `Unknown command "${text}" — type "/exit" to close this window.`);
      return;
    }

    setDraft("");
    void ask(text);
  }

  // ---- Dragging & resizing (mouse + touch), same approach as ChatWindow ----
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
    if (maximized) return; // fixed to the page below the header while maximized
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

  // Send is allowed with text OR an attached image (as long as not thinking).
  const canSend = (!!draft.trim() || !!imageDataUrl) && !thinking;

  const windowStyle: React.CSSProperties = maximized
    ? {
        // Full page, always BELOW the sticky header
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
                background: "var(--card)",
        zIndex: 9999,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <style>{`@keyframes chat-spin { to { transform: rotate(360deg); } }
.ai-chat-input::placeholder { color: #9aa4b2; opacity: 1; }`}</style>

      {/* Title bar (drag handle) */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          startDrag(e.clientX, e.clientY);
        }}
        onTouchStart={(e) =>
          startDrag(e.touches[0].clientX, e.touches[0].clientY)
        }
        style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6, #3b82f6)",
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
          <div style={{ fontWeight: 700, fontSize: 14 }}>✨ MooNyBot AI</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>
            {selectedModel === "auto"
              ? 'Free AI chat · &quot;/exit&quot; to go back to normal'
              : `${MODEL_OPTIONS.find((m) => m.value === selectedModel)?.label ?? "Free AI chat"} · &quot;/exit&quot; to close`}
                    </div>
        </div>
        <div
          ref={modelRef}
          style={{ display: "flex", gap: 4, alignItems: "center", position: "relative" }}
        >
          {/* Theme switch — synced with the portfolio's light/dark theme */}
          <button
            type="button"
            onClick={() => toggleTheme()}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              ...iconBtnStyle,
              width: 28,
              height: 28,
              fontSize: 16,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.3)",
            }}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
          {/* Model selector */}
          <button
            type="button"
            onClick={() => setShowModel((s) => !s)}
            title="AI model"
            style={{
              ...iconBtnStyle,
              fontSize: 11,
              fontWeight: 600,
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 120,
              cursor: "pointer",
            }}
          >
            {MODEL_OPTIONS.find((m) => m.value === selectedModel)?.short ?? "Auto"}
            &nbsp;▼
          </button>
          {showModel && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 6,
                minWidth: 200,
                maxHeight: 280,
                overflowY: "auto",
                background: "var(--popover)",
                color: "var(--popover-foreground)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
                zIndex: 1000,
                padding: 6,
              }}
            >
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSelectedModel(opt.value);
                    setShowModel(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background:
                      selectedModel === opt.value ? "var(--accent)" : "transparent",
                    color:
                      selectedModel === opt.value
                        ? "var(--accent-foreground)"
                        : "var(--popover-foreground)",
                    padding: "6px 8px",
                    fontSize: 12,
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{opt.hint}</div>
                </button>
              ))}
            </div>
          )}
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

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 14px",
        }}
      >
        {messages.length === 0 && !thinking && (
          <div
            style={{
              margin: "18px auto",
              maxWidth: "88%",
              textAlign: "center",
              fontSize: 13,
              lineHeight: 1.6,
              color: "#57606a",
              background: "#f6f8fa",
              border: "1px dashed #d0d7de",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            👋 You&apos;re chatting with <strong>MooNyBot</strong> — ask anything!
            <br />
            <span style={{ fontSize: 12, color: "#8a8d91" }}>
              Drag an edge or corner to resize · ⛶ for full page · &quot;/exit&quot; to
              close
            </span>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: "flex-end",
                margin: "6px 0",
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                  lineHeight: 1.5,
                  background: "#0084ff",
                  color: "#fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.imageDataUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={m.imageDataUrl}
                    alt="Attached"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: 220,
                      borderRadius: 10,
                      marginBottom: m.text ? 8 : 0,
                    }}
                  />
                )}
                {m.text}
              </div>
            </div>
          ) : (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                margin: "6px 0",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#10a37f",
                  marginBottom: 2,
                }}
              >
                ✨ MooNyBot
              </span>
              <div
                style={{
                  maxWidth: "92%",
                  padding: "10px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                  background: "#ffffff",
                  border: "1px solid rgba(16,163,127,0.25)",
                  color: "#1f2328",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}
              >
                <AIResponse text={m.text} />
              </div>
            </div>
          )
        )}

        {thinking && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              margin: "6px 0",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#10a37f",
                marginBottom: 2,
              }}
            >
              ✨ MooNyBot
            </span>
            <div
              style={{
                maxWidth: "92%",
                padding: "10px 14px",
                borderRadius: 14,
                fontSize: 14,
                lineHeight: 1.5,
                background: "#ffffff",
                border: "1px solid rgba(16,163,127,0.25)",
                color: "#1f2328",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                fontStyle: "italic",
              }}
            >
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Attached-image preview strip */}
      {imageDataUrl && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 8px",
            padding: "8px 4px",
            flexShrink: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageDataUrl}
            alt={imageName ?? "Attached image"}
            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: "#57606a",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {imageName ?? "image"}
          </span>
          <button
            title="Remove image"
            onClick={() => {
              setImageDataUrl(null);
              setImageName(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            style={{ ...iconBtnStyle, color: "#d1242f", fontSize: 13 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Input */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          padding: 8,
          borderTop: "1px solid #eee",
          gap: 8,
          flexShrink: 0,
        }}
      >
        {/* Hidden file picker for the 🖼️ upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // allow re-picking the same file later
            if (!file) return;
            if (!file.type.startsWith("image/")) {
              window.alert("Please choose an image file.");
              return;
            }
            if (file.size > MAX_IMAGE_BYTES) {
              window.alert("Image is too large — please pick one under 4 MB.");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                setImageDataUrl(reader.result);
                setImageName(file.name);
              }
            };
            reader.readAsDataURL(file);
          }}
        />
        <button
          title="Upload image"
          onClick={() => fileInputRef.current?.click()}
          style={{ ...iconBtnStyle, fontSize: 18, padding: 4 }}
        >
          🖼️
        </button>
        <button
          title="Voice input"
          onClick={() => window.alert("🎙️ Voice input — to be update")}
          style={{ ...iconBtnStyle, fontSize: 18, padding: 4 }}
        >
          🎙️
        </button>

        <textarea
          ref={inputRef}
          value={draft}
          className="ai-chat-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
            // Shift+Enter inserts a newline (default textarea behaviour).
          }}
          placeholder={
            imageDataUrl
              ? "Ask something about this image…"
              : 'Ask anything… ("/exit" to close)'
          }
          rows={1}
          wrap="soft"
          style={{
            flex: 1,
            border: "1px solid #ddd",
            borderRadius: 18,
            padding: "8px 14px",
            fontSize: 14,
            outline: "none",
            resize: "none",
            overflowY: "auto",
            minHeight: 36,
            maxHeight: 120,
            lineHeight: 1.5,
            fontFamily: "inherit",
            background: "#fff",
            // Pin explicit colors — the site's dark theme sets a near-white
            // inherited text colour, which was invisible on this white input.
            color: "#1f2328",
            caretColor: "#0084ff",
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!canSend}
          style={{
            border: "none",
            borderRadius: "50%",
            width: 36,
            height: 36,
            background: canSend ? "#0084ff" : "#c9d4e0",
            color: "#fff",
            fontSize: 15,
            cursor: canSend ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          ➤
        </button>
      </div>

      {/* Resize grips — hidden while maximized */}
      {!maximized && (
        <>
          {/* Right edge */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("e", e.clientX, e.clientY);
            }}
            onTouchStart={(e) =>
              startResize("e", e.touches[0].clientX, e.touches[0].clientY)
            }
            style={{ ...gripStyle("ew-resize"), top: 44, bottom: 14, right: 0, width: 6 }}
          />
          {/* Bottom edge */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("s", e.clientX, e.clientY);
            }}
            onTouchStart={(e) =>
              startResize("s", e.touches[0].clientX, e.touches[0].clientY)
            }
            style={{ ...gripStyle("ns-resize"), left: 44, right: 14, bottom: 0, height: 6 }}
          />
          {/* Bottom-right corner */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              startResize("se", e.clientX, e.clientY);
            }}
            onTouchStart={(e) =>
              startResize("se", e.touches[0].clientX, e.touches[0].clientY)
            }
            style={{ ...gripStyle("nwse-resize"), right: 0, bottom: 0, width: 18, height: 18 }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                d="M17 7 L7 17 M17 12 L12 17"
                stroke="#b9c2cc"
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

const iconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
  fontSize: 15,
  padding: 2,
};
