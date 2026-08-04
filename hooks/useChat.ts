"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChatSocket } from "../lib/websocket";
import type { Visitor, ChatMessage, ServerToClientEvent } from "../types/chat";

interface TypingState {
  visitorId: string;
  nickname: string;
}

export function useChat() {
  const socketRef = useRef<ChatSocket | null>(null);
  const typingTimeout = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const [you, setYou] = useState<Visitor | null>(null);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState<TypingState[]>([]);
  const [connected, setConnected] = useState(false);
  const [latestNotification, setLatestNotification] =
    useState<ChatMessage | null>(null);

  useEffect(() => {
    const socket = new ChatSocket();
    socketRef.current = socket;

    const unsubscribe = socket.on((event: ServerToClientEvent) => {
      switch (event.type) {
        case "init":
          setYou(event.you);
          setVisitors(event.visitors);
          setMessages(event.messages);
          setConnected(true);
          break;

        case "visitor_joined":
          setVisitors((prev) => {
            const exists = prev.some((v) => v.id === event.visitor.id);
            return exists
              ? prev.map((v) => (v.id === event.visitor.id ? event.visitor : v))
              : [...prev, event.visitor];
          });
          break;

        case "visitor_left":
          setVisitors((prev) => prev.filter((v) => v.id !== event.visitorId));
          break;

        case "online_count":
          setOnlineCount(event.count);
          break;

        case "message":
          setMessages((prev) => [...prev, event.message]);
          setYou((current) => {
            if (current && event.message.senderId !== current.id) {
              setLatestNotification(event.message);
            }
            return current;
          });
          break;

        case "typing": {
          const key = event.visitorId;
          if (event.isTyping) {
            setTypingUsers((prev) => {
              const exists = prev.some((t) => t.visitorId === key);
              return exists
                ? prev
                : [...prev, { visitorId: key, nickname: event.nickname }];
            });
            const existingTimer = typingTimeout.current.get(key);
            if (existingTimer) clearTimeout(existingTimer);
            const timer = setTimeout(() => {
              setTypingUsers((prev) => prev.filter((t) => t.visitorId !== key));
            }, 4000);
            typingTimeout.current.set(key, timer);
          } else {
            setTypingUsers((prev) => prev.filter((t) => t.visitorId !== key));
            const existingTimer = typingTimeout.current.get(key);
            if (existingTimer) clearTimeout(existingTimer);
          }
          break;
        }

        case "seen":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId && !m.seenBy.includes(event.visitorId)
                ? { ...m, seenBy: [...m.seenBy, event.visitorId] }
                : m
            )
          );
          break;
      }
    });

    socket.connect();

    return () => {
      unsubscribe();
      socket.disconnect();
      setConnected(false);
    };
  }, []);

  const sendMessage = useCallback((text: string) => {
    socketRef.current?.send({ type: "message", text });
  }, []);

  const setTyping = useCallback((isTyping: boolean) => {
    socketRef.current?.send({ type: "typing", isTyping });
  }, []);

  const setNickname = useCallback((nickname: string) => {
    socketRef.current?.send({ type: "identify", nickname });
  }, []);

  const markSeen = useCallback((messageId: string) => {
    socketRef.current?.send({ type: "seen", messageId });
  }, []);

  const clearNotification = useCallback(() => {
    setLatestNotification(null);
  }, []);

  return {
    you,
    visitors,
    messages,
    onlineCount,
    typingUsers,
    connected,
    latestNotification,
    sendMessage,
    setTyping,
    setNickname,
    markSeen,
    clearNotification,
  };
}