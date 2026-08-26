"use client";

import { useChat } from "@/hooks/useChat";
import { useState } from "react";
import ChatWindow from "./ChatWindow";
import AIChatWindow from "./AIChatWindow";
import QaWindow from "./QaWindow";
import Notification from"./Notification"

export default function ChatPopup() {
  const [open, setOpen] = useState(false);

  // ---- Dedicated AI chat window ("/ai" command) ----
  // aiSeq changes on every open so a newly requested question re-mounts the
  // window and is asked right away; history itself lives in localStorage.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeq, setAiSeq] = useState(0);
  const [aiQuestion, setAiQuestion] = useState<string | null>(null);

  function openAI(question?: string) {
    setAiQuestion(question ?? null);
    setAiSeq((n) => n + 1);
    setAiOpen(true);
  }

  // ---- Dedicated Excel QA window ("/qa" command) ----
  const [qaOpen, setQaOpen] = useState(false);
  const {
    you,
    visitors,
    messages,
    onlineCount,
    typingUsers,
    connected,
    latestNotification,
    steamEnabled,
    sendMessage,
    setTyping,
    setNickname,
    clearNotification,
    enableSteam,
  } = useChat();

  return (
    <div style={{ position: "fixed", bottom: 80, right: 20, zIndex: 999 }}>
      {latestNotification && !open && (
        <Notification
          message={latestNotification}
          onClose={clearNotification}
          onClick={() => {
            setOpen(true);
            clearNotification();
          }}
        />
      )}

      {open ? (
        <ChatWindow
          you={you}
          visitors={visitors}
          messages={messages}
          onlineCount={onlineCount}
          typingUsers={typingUsers}
          onSend={sendMessage}
          onTyping={setTyping}
          onNicknameChange={setNickname}
          steamEnabled={steamEnabled}
          onSteam={enableSteam}
          onClose={() => setOpen(false)}
          onMinimize={() => setOpen(false)}
          onOpenAI={openAI}
          onOpenQA={() => setQaOpen(true)}
        />
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#0084ff",
            color: "#fff",
            border: "none",
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            fontSize: 24,
            cursor: "pointer",
            position: "relative",
          }}
          title={connected ? "Open chat" : "Connecting..."}
        >
          💬
          {onlineCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                background: "#31a24c",
                color: "#fff",
                borderRadius: "50%",
                width: 18,
                height: 18,
                fontSize: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #fff",
              }}
            >
              {onlineCount}
            </span>
          )}
        </button>
      )}

      {/* Dedicated AI chat window — opened by the "/ai" command */}
      {aiOpen && (
        <AIChatWindow
          key={aiSeq}
          initialQuestion={aiQuestion}
          onClose={() => setAiOpen(false)}
        />
      )}

      {/* Dedicated Excel QA window — opened by the "/qa" command */}
      {qaOpen && (
        <QaWindow
          key={`qa-${aiSeq}`}
          onClose={() => setQaOpen(false)}
        />
      )}
    </div>
  );
}