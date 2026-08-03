// lib/online.ts
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Use global to persist across API routes
declare global {
  // eslint-disable-next-line no-var
  var __onlineUsers: Map<string, { 
    timestamp: number;
    ip: string;
    browser: string;
    browserVersion: string;
    userAgent: string;
    firstSeen: number;
    lastHeartbeat: number;
    deviceRegistered: boolean;
  }> | undefined;
}

const onlineUsers = global.__onlineUsers || new Map();
if (!global.__onlineUsers) {
  global.__onlineUsers = onlineUsers;
  console.log('🆕 Created new onlineUsers Map');
}

let lastCleanupTime = 0;

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

// Define return type
interface HeartbeatResult {
  count: number;
  isNewUser: boolean;
  userKey: string;
}

export function generateUserKey(ip: string, browser: string, browserVersion: string) {
  return `${ip}|${browser}|${browserVersion}`;
}

export function getBrowserInfo(userAgent: string) {
  return parseUserAgent(userAgent);
}

function parseUserAgent(userAgent: string) {
  let browser = 'Unknown';
  let version = 'Unknown';
  
  // Detect browser
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg') && !userAgent.includes('OPR') && !userAgent.includes('Brave')) {
    browser = 'Chrome';
    const match = userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Firefox')) {
    browser = 'Firefox';
    const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome') && !userAgent.includes('Brave')) {
    browser = 'Safari';
    const match = userAgent.match(/Version\/(\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Edg')) {
    browser = 'Edge';
    const match = userAgent.match(/Edg\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('OPR') || userAgent.includes('Opera')) {
    browser = 'Opera';
    const match = userAgent.match(/OPR\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Brave')) {
    browser = 'Brave';
    const match = userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  }
  
  return { name: browser, version };
}

export function heartbeat(sessionId: string, ip: string, userAgent: string): HeartbeatResult {
  if (!sessionId) {
    console.error("❌ Invalid sessionId");
    return { count: 0, isNewUser: false, userKey: '' };
  }
  
  // Parse browser info from user agent
  const browserInfo = parseUserAgent(userAgent);
  const userKey = generateUserKey(ip, browserInfo.name, browserInfo.version);
  
  const now = Date.now();
  const existingUser = onlineUsers.get(userKey);
  let isNewUser = false;
  
  // If user exists, update timestamp
  if (existingUser) {
    console.log(`♻️ Updating existing user: ${userKey}`);
    existingUser.timestamp = now;
    existingUser.lastHeartbeat = now;
    onlineUsers.set(userKey, existingUser);
  } else {
    // New user
    isNewUser = true;
    console.log(`🆕 New user: ${userKey}`);
    onlineUsers.set(userKey, {
      timestamp: now,
      ip,
      browser: browserInfo.name,
      browserVersion: browserInfo.version,
      userAgent,
      firstSeen: now,
      lastHeartbeat: now,
      deviceRegistered: false
    });
  }
  
  console.log(`💓 Heartbeat from ${userKey}`);
  console.log(`   IP: ${ip}, Browser: ${browserInfo.name} ${browserInfo.version}`);
  console.log(`👥 Current unique users: ${onlineUsers.size}`);
  
  return { 
    count: onlineUsers.size, 
    isNewUser, 
    userKey 
  };
}

export function getOnlineCount(shouldCleanup: boolean = true) {
  const now = Date.now();
  
  console.log(`📊 Getting online count...`);
  console.log(`Before cleanup: ${onlineUsers.size} users`);
  
  // Only cleanup if requested AND at least 1 hour has passed since last cleanup
  if (shouldCleanup && onlineUsers.size > 0 && (now - lastCleanupTime > 3600000)) {
    lastCleanupTime = now;
    let cleanedCount = 0;
    
    for (const [key, info] of onlineUsers.entries()) {
      const age = now - info.timestamp;
      if (age > CLEANUP_INTERVAL) {
        const ageHours = (age / 3600000).toFixed(1);
        console.log(`🗑️ Removing stale user: ${key} (inactive for ${ageHours}h)`);
        onlineUsers.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} stale users`);
    }
  }
  
  console.log(`After cleanup: ${onlineUsers.size} users`);
  return onlineUsers.size;
}

export function getUsersDebug() {
  const now = Date.now();
  return Array.from(onlineUsers.entries()).map(([key, info]) => ({
    key,
    ip: info.ip,
    browser: info.browser,
    browserVersion: info.browserVersion,
    firstSeen: new Date(info.firstSeen).toISOString(),
    lastSeen: new Date(info.timestamp).toISOString(),
    deviceRegistered: info.deviceRegistered,
    ageHours: ((now - info.timestamp) / 3600000).toFixed(1) + 'h'
  }));
}

export function markDeviceRegistered(userKey: string) {
  const user = onlineUsers.get(userKey);
  if (user) {
    user.deviceRegistered = true;
    onlineUsers.set(userKey, user);
    console.log(`✅ Device registered for: ${userKey}`);
    return true;
  }
  return false;
}

export function getUserInfo(userKey: string) {
  return onlineUsers.get(userKey);
}