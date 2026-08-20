import type { ClientToServerEvent, ServerToClientEvent } from "../types/chat";

// Base URL used for the file upload / download API. Defaults to the current
// origin (same host that serves the WebSocket), overridable via env.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (typeof window !== "undefined" ? window.location.origin : "");

type Listener = (event: ServerToClientEvent) => void;

export class ChatSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectDelay = 1000;
  private maxReconnectDelay = 15000;
  private shouldReconnect = true;
  private url: string;

  
  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else {
      // Allow overriding via env var — useful for local development where
      // the WS server runs on a different host/port than the Next.js app.
      const envUrl = process.env.NEXT_PUBLIC_WS_URL;
      if (envUrl) {
        this.url = envUrl;
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        this.url = `${protocol}//${window.location.host}/api/ws`;
      }
    }
  }

  connect() {
    this.shouldReconnect = true;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (raw) => {
      try {
        const event: ServerToClientEvent = JSON.parse(raw.data);
        this.listeners.forEach((l) => l(event));
      } catch {
        // ignore malformed frame
      }
    };

    this.ws.onclose = () => {
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 1.5,
          this.maxReconnectDelay
        );
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  send(event: ClientToServerEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}