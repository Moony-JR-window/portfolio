"use client";

import { ChatMessage } from "@/types/chat";
import { useEffect } from "react";

interface Props {
  message: ChatMessage;
  onClose: () => void;
  onClick: () => void;
}

export default function Notification({ message, onClose, onClick }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      onClick={onClick}
      style={{
        position: "fixed",
        bottom: 90,
        right: 24,
        width: 280,
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 4px 18px rgba(0,0,0,0.18)",
        padding: "12px 14px",
        cursor: "pointer",
        zIndex: 1000,
        animation: "chat-notif-in 0.2s ease-out",
      }}
    >
      <style>{`
        @keyframes chat-notif-in {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          💬 {message.senderNickname}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#8a8d91",
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>
      <div
        style={{
          fontSize: 13,
          color: "#333",
          marginTop: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {message.text}
      </div>
    </div>
  );
}