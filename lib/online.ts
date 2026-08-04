// lib/online.ts

declare global {
  // eslint-disable-next-line no-var
  var __onlineUsers:
    | Map<
        string,
        {
          timestamp: number;
          ip: string;
          browser: string;
          browserVersion: string;
          userAgent: string;
          firstSeen: number;
          lastHeartbeat: number;
          deviceRegistered: boolean;
        }
      >
    | undefined;

  // eslint-disable-next-line no-var
  var __currentDay: string | undefined;
}

interface UserInfo {
  timestamp: number;
  ip: string;
  browser: string;
  browserVersion: string;
  userAgent: string;
  firstSeen: number;
  lastHeartbeat: number;
  deviceRegistered: boolean;
}

interface HeartbeatResult {
  count: number;
  isNewUser: boolean;
  userKey: string;
}

const onlineUsers = global.__onlineUsers || new Map<string, UserInfo>();

if (!global.__onlineUsers) {
  global.__onlineUsers = onlineUsers;
  console.log("🆕 Created online user map");
}

if (!global.__currentDay) {
  global.__currentDay = getToday();
}

/**
 * Return local date as YYYY-MM-DD
 */
function getToday() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Reset map automatically when date changes.
 */
function resetIfNewDay() {
  const today = getToday();

  if (global.__currentDay !== today) {
    console.log("🌅 New day detected");
    console.log(`Old Day : ${global.__currentDay}`);
    console.log(`New Day : ${today}`);
    console.log(`Yesterday Visitors : ${onlineUsers.size}`);

    onlineUsers.clear();

    global.__currentDay = today;

    console.log("🧹 Daily visitor map cleared");
  }
}

export function getBrowserInfo(userAgent: string) {
  return parseUserAgent(userAgent);
}

function parseUserAgent(userAgent: string) {
  let browser = "Unknown";
  let version = "Unknown";

  if (
    userAgent.includes("Chrome") &&
    !userAgent.includes("Edg") &&
    !userAgent.includes("OPR") &&
    !userAgent.includes("Brave")
  ) {
    browser = "Chrome";
    const match = userAgent.match(/Chrome\/([\d.]+)/);
    version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Firefox")) {
    browser = "Firefox";
    const match = userAgent.match(/Firefox\/([\d.]+)/);
    version = match ? match[1] : "Unknown";
  } else if (
    userAgent.includes("Safari") &&
    !userAgent.includes("Chrome")
  ) {
    browser = "Safari";
    const match = userAgent.match(/Version\/([\d.]+)/);
    version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Edg")) {
    browser = "Edge";
    const match = userAgent.match(/Edg\/([\d.]+)/);
    version = match ? match[1] : "Unknown";
  } else if (
    userAgent.includes("OPR") ||
    userAgent.includes("Opera")
  ) {
    browser = "Opera";
    const match = userAgent.match(/OPR\/([\d.]+)/);
    version = match ? match[1] : "Unknown";
  }

  return {
    name: browser,
    version,
  };
}

export function generateUserKey(
  ip: string,
  browser: string,
  browserVersion: string
) {
  return `${ip}|${browser}|${browserVersion}`;
}

export function heartbeat(
  sessionId: string,
  ip: string,
  userAgent: string
): HeartbeatResult {
  resetIfNewDay();

  if (!sessionId) {
    return {
      count: onlineUsers.size,
      isNewUser: false,
      userKey: "",
    };
  }

  const browserInfo = parseUserAgent(userAgent);

  const userKey = generateUserKey(
    ip,
    browserInfo.name,
    browserInfo.version
  );

  const now = Date.now();

  const existing = onlineUsers.get(userKey);

  let isNewUser = false;

  if (existing) {
    existing.timestamp = now;
    existing.lastHeartbeat = now;
    onlineUsers.set(userKey, existing);

    console.log(`♻️ Existing visitor`);
  } else {
    isNewUser = true;

    onlineUsers.set(userKey, {
      timestamp: now,
      ip,
      browser: browserInfo.name,
      browserVersion: browserInfo.version,
      userAgent,
      firstSeen: now,
      lastHeartbeat: now,
      deviceRegistered: false,
    });

    console.log(`🆕 New visitor today`);
  }

  console.log("----------------------------");
  console.log(`Date : ${global.__currentDay}`);
  console.log(`IP : ${ip}`);
  console.log(`Browser : ${browserInfo.name} ${browserInfo.version}`);
  console.log(`Today's Visitors : ${onlineUsers.size}`);
  console.log("----------------------------");

  return {
    count: onlineUsers.size,
    isNewUser,
    userKey,
  };
}

export function getOnlineCount() {
  resetIfNewDay();
  return onlineUsers.size;
}

export function getUsersDebug() {
  resetIfNewDay();

  return Array.from(onlineUsers.entries()).map(([key, info]) => ({
    key,
    ip: info.ip,
    browser: info.browser,
    browserVersion: info.browserVersion,
    firstSeen: new Date(info.firstSeen).toLocaleString(),
    lastSeen: new Date(info.lastHeartbeat).toLocaleString(),
    deviceRegistered: info.deviceRegistered,
  }));
}

export function markDeviceRegistered(userKey: string) {
  resetIfNewDay();

  const user = onlineUsers.get(userKey);

  if (!user) {
    return false;
  }

  user.deviceRegistered = true;
  onlineUsers.set(userKey, user);

  return true;
}

export function getUserInfo(userKey: string) {
  resetIfNewDay();
  return onlineUsers.get(userKey);
}