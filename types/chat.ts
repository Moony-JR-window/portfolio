export interface Visitor {
  id: string;
  nickname: string;
  ip: string;
  browser: string;
  online: boolean;
  lastSeen: number;
  connectedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderNickname: string;
  text: string;
  timestamp: number;
  seenBy: string[];
}

export type ClientToServerEvent =
  | { type: "identify"; nickname?: string }
  | { type: "message"; text: string }
  | { type: "typing"; isTyping: boolean }
  | { type: "seen"; messageId: string }
  | { type: "ping" };

export type ServerToClientEvent =
  | { type: "init"; you: Visitor; visitors: Visitor[]; messages: ChatMessage[] }
  | { type: "visitor_joined"; visitor: Visitor }
  | { type: "visitor_left"; visitorId: string }
  | { type: "online_count"; count: number }
  | { type: "message"; message: ChatMessage }
  | { type: "typing"; visitorId: string; nickname: string; isTyping: boolean }
  | { type: "seen"; messageId: string; visitorId: string }
  | { type: "pong" };