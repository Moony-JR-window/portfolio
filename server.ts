import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { chatStore } from "./lib/chat-store";
import type {
  ClientToServerEvent,
  ServerToClientEvent,
  Visitor,
  ChatMessage,
} from "./types/chat";

const PORT = Number(process.env.WS_PORT || 3001);

interface ClientConn {
  id: string;
  ws: WebSocket;
}

const clients = new Map<string, ClientConn>();

function send(ws: WebSocket, event: ServerToClientEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function broadcast(event: ServerToClientEvent, exceptId?: string) {
  for (const [id, client] of clients) {
    if (id === exceptId) continue;
    send(client.ws, event);
  }
}

const wss = new WebSocketServer({
  port: PORT,
});

console.log(`✅ WebSocket Server`);
console.log(`ws://localhost:${PORT}`);

wss.on("connection", (ws, req) => {
  const id = randomUUID();

  clients.set(id, { id, ws });

  const visitor: Visitor = {
    id,
    nickname: chatStore.generateGuestNickname(),
    ip: req.socket.remoteAddress ?? "",
    browser: "Unknown",
    online: true,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
  };

  chatStore.addVisitor(visitor);

  send(ws, {
    type: "init",
    you: visitor,
    visitors: chatStore.getAllVisitors(),
    messages: chatStore.getRecentMessages(),
  });

  ws.on("message", (raw) => {
    let event: ClientToServerEvent;

    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === "message") {
      const sender = chatStore.getVisitor(id);
      if (!sender) return;

      const message: ChatMessage = {
        id: randomUUID(),
        senderId: id,
        senderNickname: sender.nickname,
        text: event.text,
        timestamp: Date.now(),
        seenBy: [id],
      };

      chatStore.addMessage(message);

      broadcast({
        type: "message",
        message,
      });
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    chatStore.removeVisitor(id);
  });
});