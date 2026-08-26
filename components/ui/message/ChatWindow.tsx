"use client";

import { useEffect, useRef, useState } from "react";

import MessageBubble from "./MessageBubble";
import OnlineBadge from "./OnlineBadge";
import { Visitor, ChatMessage, FileAttachment } from "@/types/chat";
import BotCommandMenu from "./BotCommandMenu";
import { useMessageSounds, isSoundMuted } from "./useMessageSounds";
// import { API_BASE } from "@/lib/websocket";
interface Props {
  you: Visitor | null;
  visitors: Visitor[];
  messages: ChatMessage[];
  onlineCount: number;
  typingUsers: { visitorId: string; nickname: string }[];
  onSend: (text: string, file?: FileAttachment) => void;
  onTyping: (isTyping: boolean) => void;
  onNicknameChange: (nickname: string) => void;
  steamEnabled: boolean;
  onSteam: () => void;
  /** Open the dedicated AI chat window ("/ai" command); optional first question. */
  onOpenAI: (question?: string) => void;
  onClose: () => void;
  onMinimize: () => void;
}

export default function ChatWindow({
  you,
  visitors,
  messages,
  onlineCount,
  typingUsers,
  onSend,
  onTyping,
  onNicknameChange,
  steamEnabled,
  onSteam,
  onOpenAI,
  onClose,
  onMinimize,
}: Props) {
  const [draft, setDraft] = useState("");
  const [showVisitors, setShowVisitors] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sending, setSending] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const offsetRef = useRef({ x: 0, y: 0 })
  const elRef = useRef<HTMLDivElement>(null)
  const [showCommands, setShowCommands] = useState(false);
  const [showBotMenu, setShowBotMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [steamNotice, setSteamNotice] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "info"; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [soundOn, setSoundOn] = useState<boolean>(!isSoundMuted());
  const { playType, playSend, toggleMuted } = useMessageSounds();

  function showNotice(type: "error" | "info", text: string, duration = 4000) {
    setNotice({ type, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), duration);
  }



  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typingUsers]);

  // Auto-grow the message box (ChatGPT-style) when the draft gets long.
  useEffect(() => {
    const ta = messageInputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [draft]);

  function handleChange(value: string) {
    setDraft(value);

    // Messenger-style keypress sound
    if (value && soundOn) playType();

    // Show slash command popup
    setShowCommands(value.startsWith("/"));

    onTyping(true);

    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 1500);
  }

  // function handleSubmit() {
  //   const text = draft.trim();
  //   if (!text) return;
  //   onSend(text);
  //   setDraft("");
  //   onTyping(false);
  // }

  function handleSubmit() {
    const text = draft.trim();
    if (!text) return;

    // Slash commands: handle /steam & /ai locally, ignore the rest
    if (text.startsWith("/")) {
      const lower = text.toLowerCase();

      if (lower === "/steam") {
        onSteam();
        setDraft("");
        onTyping(false);
        setShowCommands(false);
        setSteamNotice(true);
        setTimeout(() => setSteamNotice(false), 4000);
        return;
      }

      if (lower === "/ai" || lower.startsWith("/ai ")) {
        setDraft("");
        onTyping(false);
        setShowCommands(false);
        // The AI moved to its own dedicated chat window — pass along any
        // question typed after "/ai" so it is asked there right away.
        const question = text.replace(/^\/ai\s*/i, "").trim();
        onOpenAI(question || undefined);
        return;
      }

      return;
    }

    onSend(text);
    setDraft("");
    onTyping(false);
    // Messenger-style sent sound
    if (soundOn) playSend();
  }

  async function uploadFile(file: File) {
    if (!steamEnabled) {
      showNotice("info", 'Run "/steam" to enable file upload');
      return;
    }

    setUploading(true);
    setUploadingName(file.name);
    try {
      const postId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const form = new FormData();
      form.append("file", file);

      const res = await fetch(`/api/upload-any/1`, {
        method: "POST",
        body: form,
      });

      console.log("Upload response:", res.status, res.statusText);

      if (!res.ok) {
        const text = await res.text();
        console.error("Upload failed:", text);
        throw new Error(`Upload failed: ${res.status}`);
      }

      const data = await res.json();
      console.log("Upload result:", data);

      onSend(`📎 ${file.name}`, {
        postId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      });

      setDraft("");
      onTyping(false);

    } catch (err) {
      console.error("Upload error:", err);
      showNotice("error", "Upload failed. Please try again.");

    } finally {
      setUploading(false);
      setUploadingName(null);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await uploadFile(file);
  }

  function submitNickname() {
    const nickname = nicknameDraft.trim();
    if (nickname) onNicknameChange(nickname);
    setEditingNickname(false);
  }


  // Free dragging anywhere on screen (mouse + touch).
  useEffect(() => {
    function clamp(clientX: number, clientY: number) {
      const width = elRef.current?.offsetWidth ?? 220
      const height = elRef.current?.offsetHeight ?? 48
      const margin = 8
      const x = Math.max(
        margin,
        Math.min(clientX - offsetRef.current.x, window.innerWidth - width - margin),
      )
      const y = Math.max(
        margin,
        Math.min(clientY - offsetRef.current.y, window.innerHeight - height - margin),
      )
      return { x, y }
    }
    const move = (clientX: number, clientY: number) => {
      if (draggingRef.current) setPos(clamp(clientX, clientY))
    }
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY)
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current) {
        e.preventDefault()
        move(e.touches[0].clientX, e.touches[0].clientY)
      }
    }
    const onUp = () => {
      draggingRef.current = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [])

  function startDrag(clientX: number, clientY: number) {
    const el = elRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    offsetRef.current = { x: clientX - rect.left, y: clientY - rect.top }
    setPos({ x: rect.left, y: rect.top })
    draggingRef.current = true
  }

  return (
    <div
      ref={elRef}
      className="backdrop-blur-md"
      style={{
        position: "fixed",
        left: pos?.x ?? window.innerWidth - 340,
        top: pos?.y ?? window.innerHeight - 480,

        width: 320,
        height: 440,

        borderRadius: 12,
        boxShadow: "0 8px 28px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 9999,

        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <style>{`@keyframes chat-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div
        onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
        onTouchStart={(e) =>
          startDrag(e.touches[0].clientX, e.touches[0].clientY)
        }
        style={{
          background: "#0084ff",
          color: "#fff",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>💬 Community Chat</div>
          <OnlineBadge count={visitors.length} />
        </div>
        <div
          className=" z-40"
          style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => {
              const next = toggleMuted();
              setSoundOn(!next);
            }}
            title={soundOn ? "Mute sounds" : "Unmute sounds"}
            style={iconBtnStyle}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          <button
            onClick={() => setShowVisitors((s) => !s)}
            title="Visitors"
            style={iconBtnStyle}
          >
            👥
          </button>
          <button onClick={onMinimize} title="Minimize" style={iconBtnStyle}>
            ─
          </button>
          <button onClick={onClose} title="Close" style={iconBtnStyle}>
            ✕
          </button>
        </div>
      </div>

      {/* Your nickname row */}
      <div
        style={{
          padding: "6px 12px",
          fontSize: 12,
          color: "#65676b",
          borderBottom: "1px solid #eee",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {editingNickname ? (
          <input
            autoFocus
            value={nicknameDraft}
            onChange={(e) => setNicknameDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNickname()}
            onBlur={submitNickname}
            maxLength={24}
            style={{
              fontSize: 12,
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "2px 6px",
              width: 140,
            }}
          />
        ) : (
          <span>
            You are{" "}
            <strong
              onClick={() => {
                setNicknameDraft(you?.nickname || "");
                setEditingNickname(true);
              }}
              style={{ cursor: "pointer", color: "#0084ff" }}
            >
              {you?.nickname ?? "…"}
            </strong>{" "}
            (tap to rename)
          </span>
        )}
      </div>

      {/* Visitor list overlay */}
      {showVisitors ? (
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {visitors.map((v) => (
            <div
              key={v.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 4px",
                borderBottom: "1px solid #f0f0f0",
                fontSize: 13,
              }}
            >
              <span>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    display: "inline-block",
                    marginRight: 6,
                    background: v.online ? "#31a24c" : "#bcc0c4",
                  }}
                />
                {v.nickname} {v.id === you?.id ? "(you)" : ""}
              </span>
              <span style={{ color: "#8a8d91", fontSize: 11 }}>
                {v.browser} · {v.ip}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div
            ref={scrollRef}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void uploadFile(file);
            }}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 12px",
            }}
          >
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                isOwn={m.senderId === you?.id}
                steamEnabled={steamEnabled}
                onNotify={(msg) => showNotice("error", msg)}
                seenLabel={
                  m.senderId === you?.id && m.seenBy.length > 1 ? "Seen" : undefined
                }
              />
            ))}
            {typingUsers.length > 0 && (
              <div style={{ fontSize: 12, color: "#8a8d91", fontStyle: "italic", marginTop: 4 }}>
                {typingUsers.map((t) => t.nickname).join(", ")}{" "}
                {typingUsers.length === 1 ? "is" : "are"} typing...
              </div>
            )}

            {uploadingName && (
              <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#eaf3ff",
                    color: "#0084ff",
                    borderRadius: 16,
                    padding: "8px 12px",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: "2px solid currentColor",
                      borderTopColor: "transparent",
                      animation: "chat-spin 0.8s linear infinite",
                    }}
                  />
                  Uploading {uploadingName}…
                </div>
              </div>
            )}
          </div>

          {notice && (
            <div
              style={{
                textAlign: "center",
                fontSize: 12,
                padding: "6px 12px",
                borderTop: "1px solid #eee",
                background: notice.type === "error" ? "#ffecec" : "#eaf3ff",
                color: notice.type === "error" ? "#d93025" : "#0084ff",
              }}
            >
              {notice.type === "error" ? "⚠️ " : "ℹ️ "}
              {notice.text}
            </div>
          )}

          {steamNotice && (
            <div
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "#0084ff",
                background: "#e8f4ff",
                padding: "6px 12px",
                borderTop: "1px solid #d2e7ff",
              }}
            >
              ✅ Steam enabled — file upload is now available
            </div>
          )}

          {/* Input */}
          <div
            style={{
              position: "relative", // IMPORTANT
              display: "flex",
              alignItems: "flex-end",
              padding: 8,
              borderTop: "1px solid #eee",
              gap: 8,
            }}
          >
            <BotCommandMenu
              showCommands={showCommands}
              showBotMenu={showBotMenu}
              onOpenBot={() => {
                setShowCommands(false);
                setShowBotMenu(true);
                setDraft("");
              }}
              onCloseBot={() => setShowBotMenu(false)}
              onAI={() => {
                setShowCommands(false);
                setDraft("/ai ");
                // Focus the text input with the cursor at the END so the user can
                // start typing the question right away (not at the start).
                requestAnimationFrame(() => {
                  const input = messageInputRef.current;
                  if (!input) return;
                  input.focus();
                  const len = input.value.length || "/ai ".length;
                  try {
                    input.setSelectionRange(len, len);
                  } catch {
                    /* best effort */
                  }
                });
              }}
            />

            {steamEnabled ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  onChange={handleFileChange}
                />
                <button
                  title="Attach file"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ ...iconBtnStyle, fontSize: 18, color: "#0084ff", padding: 4 }}
                >
                  {uploading ? "⏳" : "📎"}
                </button>
              </>
            ) : null}

            <textarea
              ref={messageInputRef}
              value={draft}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
                // Shift+Enter inserts a newline (default textarea behaviour).
              }}
              placeholder="Type a message... (Shift+Enter for new line)"
              rows={1}
              wrap="soft"
              style={{
                flex: 1,
                border: "none",
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
              }}
              className="backdrop-blur-md"
            />

            <button
              onClick={handleSubmit}
              disabled={!draft.trim()}
            >
              ➤
            </button>
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
  fontSize: 14,
  padding: 2,
};

const botItemStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  background: "#fff",
  padding: 12,
  cursor: "pointer",
  textAlign: "left",
  borderBottom: "1px solid #eee",
};