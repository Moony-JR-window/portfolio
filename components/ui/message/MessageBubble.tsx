"use client";

import { ChatMessage } from "@/types/chat";


interface Props {
  message: ChatMessage;
  isOwn: boolean;
  seenLabel?: string;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageBubble({ message, isOwn, seenLabel }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isOwn ? "flex-end" : "flex-start", margin: "6px 0" }}>
      {!isOwn && (
        <span style={{ fontSize: 11, fontWeight: 600, color: "#65676b", marginBottom: 2 }}>
          {message.senderNickname}
        </span>
      )}
      <div
        style={{
          maxWidth: "75%",
          padding: "8px 12px",
          borderRadius: 16,
          fontSize: 14,
          lineHeight: 1.35,
          wordBreak: "break-word",
          background: isOwn ? "#0084ff" : "#e4e6eb",
          color: isOwn ? "#fff" : "#050505",
        }}
      >
        {message.text}
      </div>
      <span style={{ fontSize: 10, color: "#8a8d91", marginTop: 2 }}>
        {formatTime(message.timestamp)}
        {isOwn && seenLabel ? ` · ${seenLabel}` : ""}
      </span>
    </div>
  );
}