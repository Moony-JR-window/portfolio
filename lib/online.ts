const onlineUsers = new Map<string, number>();

export function heartbeat(sessionId: string) {
  console.log("heartbeat:", sessionId);

  onlineUsers.set(sessionId, Date.now());

  console.log("users:", onlineUsers.size);
}

export function getOnlineCount() {
  console.log("before cleanup:", onlineUsers.size);

  const now = Date.now();
  const timeout = 2 * 60 * 1000;

  for (const [id, lastSeen] of onlineUsers.entries()) {
    if (now - lastSeen > timeout) {
      onlineUsers.delete(id);
    }
  }

  console.log("after cleanup:", onlineUsers.size);

  return onlineUsers.size;
}