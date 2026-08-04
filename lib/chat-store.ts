import { ChatMessage, Visitor } from "@/types/chat";


/**
 * Pure in-memory store. Everything resets on server restart.
 * Safe for a single Node process. If you scale to multiple
 * instances you'll need Redis pub/sub instead of this.
 */
class ChatStore {
  private visitors = new Map<string, Visitor>();
  private messages: ChatMessage[] = [];
  private readonly MAX_MESSAGES = 200;

  // ---------- Visitors ----------

  addVisitor(visitor: Visitor) {
    this.visitors.set(visitor.id, visitor);
  }

  removeVisitor(id: string) {
    this.visitors.delete(id);
  }

  getVisitor(id: string): Visitor | undefined {
    return this.visitors.get(id);
  }

  updateVisitor(id: string, patch: Partial<Visitor>) {
    const v = this.visitors.get(id);
    if (!v) return;
    this.visitors.set(id, { ...v, ...patch });
  }

  getAllVisitors(): Visitor[] {
    return Array.from(this.visitors.values());
  }

  getOnlineCount(): number {
    return Array.from(this.visitors.values()).filter((v) => v.online).length;
  }

  nicknameTaken(nickname: string): boolean {
    return Array.from(this.visitors.values()).some(
      (v) => v.nickname.toLowerCase() === nickname.toLowerCase()
    );
  }

  generateGuestNickname(): string {
    let n: string;
    do {
      n = `Guest-${Math.floor(100 + Math.random() * 900)}`;
    } while (this.nicknameTaken(n));
    return n;
  }

  // ---------- Messages ----------

  addMessage(message: ChatMessage) {
    this.messages.push(message);
    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages.shift();
    }
  }

  getRecentMessages(limit = 50): ChatMessage[] {
    return this.messages.slice(-limit);
  }

  markSeen(messageId: string, visitorId: string) {
    const msg = this.messages.find((m) => m.id === messageId);
    if (msg && !msg.seenBy.includes(visitorId)) {
      msg.seenBy.push(visitorId);
    }
  }
}

// Singleton across hot reloads in dev
const globalForChat = globalThis as unknown as { chatStore?: ChatStore };

export const chatStore = globalForChat.chatStore ?? new ChatStore();
globalForChat.chatStore = chatStore;