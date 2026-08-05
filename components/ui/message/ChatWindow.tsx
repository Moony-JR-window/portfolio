"use client";

import { useEffect, useRef, useState } from "react";

import MessageBubble from "./MessageBubble";
import OnlineBadge from "./OnlineBadge";
import { Visitor, ChatMessage } from "@/types/chat";
import BotCommandMenu from "./BotCommandMenu";

interface Props {
  you: Visitor | null;
  visitors: Visitor[];
  messages: ChatMessage[];
  onlineCount: number;
  typingUsers: { visitorId: string; nickname: string }[];
  onSend: (text: string) => void;
  onTyping: (isTyping: boolean) => void;
  onNicknameChange: (nickname: string) => void;
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



  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typingUsers]);

  function handleChange(value: string) {
    setDraft(value);

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

    // Prevent sending slash commands
    if (text.startsWith("/")) return;

    onSend(text);
    setDraft("");
    onTyping(false);
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
          </div>

          {/* Input */}
          <div
            style={{
              position: "relative", // IMPORTANT
              display: "flex",
              alignItems: "center",
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
            />

            <input
              value={draft}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Type a message..."
              style={{
                flex: 1,
                border: "none",
                borderRadius: 18,
                padding: "8px 14px",
                fontSize: 14,
                outline: "none",
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