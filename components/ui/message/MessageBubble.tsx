"use client";

import { ChatMessage, FileAttachment } from "@/types/chat";
import { API_BASE } from "@/lib/websocket";


interface Props {
  message: ChatMessage;
  isOwn: boolean;
  steamEnabled: boolean;
  onNotify?: (msg: string) => void;
  seenLabel?: string;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadFile(file: FileAttachment, onNotify?: (msg: string) => void) {
  try {
    const res = await fetch(`${API_BASE}/api/download/${file.postId}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    onNotify?.("Download failed");
  }
}

export default function MessageBubble({ message, isOwn, steamEnabled, onNotify, seenLabel }: Props) {
  // The file attachment is only visible to viewers who enabled the /steam flag.
  const showFile = !!message.file && steamEnabled;

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

        {showFile && message.file && (
          <button
            onClick={() => downloadFile(message.file as FileAttachment, onNotify)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 8,
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              cursor: "pointer",
              textAlign: "left",
              background: isOwn ? "rgba(255,255,255,0.16)" : "#fff",
              color: isOwn ? "#fff" : "#050505",
            }}
          >
            <span style={{ fontSize: 20 }}>📄</span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {message.file.fileName}
              </span>
              <span style={{ fontSize: 11, opacity: 0.75 }}>
                {formatSize(message.file.size)}
                {formatSize(message.file.size) ? " · " : ""}Click to download
              </span>
            </span>
          </button>
        )}
      </div>
      <span style={{ fontSize: 10, color: "#8a8d91", marginTop: 2 }}>
        {formatTime(message.timestamp)}
        {isOwn && seenLabel ? ` · ${seenLabel}` : ""}
      </span>
    </div>
  );
}
